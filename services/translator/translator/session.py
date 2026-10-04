"""
One live class translation session.

Joins the class's LiveKit room as a service participant, subscribes to the
teacher's microphone, and publishes one audio track per target language
plus captions on a data channel. Languages are added and removed at
runtime (a student picking a new language mid-class) without
reconnecting, so nobody else's audio is interrupted.

Source resolution is by identity PREFIX, never by track sid: the teacher
re-publishes their mic every time they toggle it, so any sid captured at
join time is stale within seconds.
"""

from __future__ import annotations

import asyncio
import json
import logging

import numpy as np
import soxr
from livekit import rtc

from .config import FRAME_MS, MODEL_SAMPLE_RATE, OUTPUT_SAMPLE_RATE
from .engine.model import EngineParams, engine
from .engine.scheduler import scheduler
from .engine.stream import TextDelta, TranslationStream

log = logging.getLogger(__name__)

CAPTIONS_TOPIC = "tr:captions"
FRAME_SAMPLES = OUTPUT_SAMPLE_RATE * FRAME_MS // 1000


def translation_track_name(lang: str) -> str:
    return f"tr:{lang}"


class LanguageChannel:
    """One published track plus the task that keeps it fed."""

    def __init__(self, session: "TranslationSession", stream: TranslationStream) -> None:
        self.stream = stream
        self._session = session
        self._source: rtc.AudioSource | None = None
        self._publication: rtc.LocalTrackPublication | None = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self.stream.playout is None:
            # Caption-only language: nothing to publish. The student keeps
            # the teacher's own audio and reads along.
            return
        self._source = rtc.AudioSource(OUTPUT_SAMPLE_RATE, 1)
        # The track NAME — which is how every client tells `tr:hin` from
        # `tr:ben`, and what the subscription filters match on — comes
        # from create_audio_track's first argument. TrackPublishOptions
        # has no `name` field, and passing one raises.
        track = rtc.LocalAudioTrack.create_audio_track(translation_track_name(self.stream.lang), self._source)
        self._publication = await self._session.room.local_participant.publish_track(
            track,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        self._task = asyncio.create_task(self._pump(), name=f"playout-{self.stream.lang}")

    async def _pump(self) -> None:
        """Pushes exactly one 20ms frame every 20ms, forever.

        Driven by a wall clock rather than by awaiting the buffer, so a
        starved buffer emits silence and the track never stalls — a
        stalled WebRTC audio track is treated as a network problem by the
        receiver and recovers much more slowly than a silent one.
        """
        assert self._source is not None
        frame_interval = FRAME_MS / 1000
        next_at = asyncio.get_running_loop().time()
        while True:
            samples = self.stream.playout.next_frame() if self.stream.playout else np.zeros(FRAME_SAMPLES, dtype=np.float32)
            pcm16 = np.clip(samples, -1.0, 1.0)
            frame = rtc.AudioFrame(
                data=(pcm16 * 32767).astype(np.int16).tobytes(),
                sample_rate=OUTPUT_SAMPLE_RATE,
                num_channels=1,
                samples_per_channel=FRAME_SAMPLES,
            )
            try:
                await self._source.capture_frame(frame)
            except Exception:  # noqa: BLE001
                log.exception("capture_frame failed for %s", self.stream.lang)
                return
            next_at += frame_interval
            delay = next_at - asyncio.get_running_loop().time()
            if delay > 0:
                await asyncio.sleep(delay)
            else:
                # Fell behind the clock (a long GC pause, a busy host);
                # resync rather than trying to catch up with a burst of
                # frames, which would just arrive late anyway.
                next_at = asyncio.get_running_loop().time()

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._publication is not None:
            try:
                await self._session.room.local_participant.unpublish_track(self._publication.sid)
            except Exception:  # noqa: BLE001 — teardown is best-effort
                log.debug("unpublish failed for %s", self.stream.lang, exc_info=True)
            self._publication = None
        if self._source is not None:
            await self._source.aclose()
            self._source = None


class TranslationSession:
    def __init__(
        self,
        *,
        session_id: str,
        room_name: str,
        livekit_url: str,
        token: str,
        source_identity_prefix: str,
        source_language: str,
        params: EngineParams,
    ) -> None:
        self.session_id = session_id
        self.room_name = room_name
        self.livekit_url = livekit_url
        self.token = token
        self.source_identity_prefix = source_identity_prefix
        self.source_language = source_language
        self.params = params
        self.room = rtc.Room()
        self.channels: dict[str, LanguageChannel] = {}
        self.connected = False
        self._audio_task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._closing = False

    # ---- lifecycle -------------------------------------------------------

    async def connect(self) -> None:
        self._loop = asyncio.get_running_loop()

        @self.room.on("track_subscribed")
        def _on_track(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
            if track.kind != rtc.TrackKind.KIND_AUDIO:
                return
            if not participant.identity.startswith(self.source_identity_prefix):
                return
            # Re-binds on every (re)publish: the teacher toggling their mic
            # unpublishes and republishes, so this is the normal path, not
            # just a recovery one.
            if self._audio_task is not None:
                self._audio_task.cancel()
            self._audio_task = asyncio.create_task(self._consume(track), name=f"source-{self.session_id}")
            log.info("session %s bound to source track from %s", self.session_id, participant.identity)

        @self.room.on("disconnected")
        def _on_disconnected(_reason=None) -> None:  # noqa: ANN001
            self.connected = False
            log.warning("session %s disconnected from %s", self.session_id, self.room_name)

        await self.room.connect(
            self.livekit_url,
            self.token,
            # Only the teacher's mic matters; auto-subscribing would also
            # pull in 40 students' microphones and every screen share,
            # and feeding student audio into the translator would make a
            # mess of the teacher's translation.
            rtc.RoomOptions(auto_subscribe=False),
        )
        self.connected = True
        await self._subscribe_to_source()
        log.info("session %s connected to %s", self.session_id, self.room_name)

    async def _subscribe_to_source(self) -> None:
        """Opts in to the teacher's mic, including for a track that was
        already published before we joined."""
        for participant in self.room.remote_participants.values():
            if not participant.identity.startswith(self.source_identity_prefix):
                continue
            for publication in participant.track_publications.values():
                if publication.kind == rtc.TrackKind.KIND_AUDIO:
                    publication.set_subscribed(True)

        @self.room.on("track_published")
        def _on_published(publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
            if publication.kind == rtc.TrackKind.KIND_AUDIO and participant.identity.startswith(self.source_identity_prefix):
                publication.set_subscribed(True)

    async def _consume(self, track: rtc.Track) -> None:
        """Feeds the teacher's audio into every language stream."""
        audio_stream = rtc.AudioStream(track, sample_rate=MODEL_SAMPLE_RATE, num_channels=1)
        try:
            async for event in audio_stream:
                frame = event.frame
                samples = np.frombuffer(frame.data, dtype=np.int16).astype(np.float32) / 32768.0
                if frame.sample_rate != MODEL_SAMPLE_RATE:
                    samples = soxr.resample(samples, frame.sample_rate, MODEL_SAMPLE_RATE)
                # One copy of the source feeds every language: the streams
                # are independent decoders over the same audio, which is
                # why N languages cost N decoder passes but only one
                # capture.
                for channel in list(self.channels.values()):
                    channel.stream.feed(samples)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("source consumption failed for session %s", self.session_id)
        finally:
            await audio_stream.aclose()

    async def close(self) -> None:
        self._closing = True
        if self._audio_task is not None:
            self._audio_task.cancel()
            try:
                await self._audio_task
            except asyncio.CancelledError:
                pass
        for lang in list(self.channels):
            await self.remove_language(lang)
        scheduler.remove_session(self.session_id)
        try:
            await self.room.disconnect()
        except Exception:  # noqa: BLE001
            log.debug("room disconnect failed for %s", self.session_id, exc_info=True)
        self.connected = False

    # ---- language set ----------------------------------------------------

    async def set_languages(self, langs: list[str], params: EngineParams) -> None:
        """Converges on `langs`. Idempotent — an unchanged set does nothing,
        which is what makes the server's reconciler safe to call often."""
        self.params = params
        wanted = set(langs)
        for lang in list(self.channels):
            if lang not in wanted:
                await self.remove_language(lang)
        for lang in langs:
            if lang not in self.channels:
                await self.add_language(lang, params)

    async def add_language(self, lang: str, params: EngineParams) -> None:
        if lang in self.channels:
            return
        stream = TranslationStream(lang=lang, params=params)
        channel = LanguageChannel(self, stream)
        # Registered with the scheduler BEFORE publishing, so no frame is
        # ever pumped from a buffer that has no producer behind it.
        scheduler.add(self.session_id, stream, lambda deltas, l=lang: self._publish_captions(l, deltas))
        self.channels[lang] = channel
        try:
            await channel.start()
        except Exception:
            scheduler.remove(self.session_id, lang)
            self.channels.pop(lang, None)
            raise

    async def remove_language(self, lang: str) -> None:
        channel = self.channels.pop(lang, None)
        if channel is None:
            return
        scheduler.remove(self.session_id, lang)
        await channel.stop()

    # ---- captions --------------------------------------------------------

    def _publish_captions(self, lang: str, deltas: list[TextDelta]) -> None:
        """Called from the GPU thread, so the actual send is hopped onto
        the event loop — rtc's publish_data is not thread-safe."""
        if self._loop is None or self._closing or not deltas:
            return
        for delta in deltas:
            payload = json.dumps(
                {"lang": lang, "segId": delta.seg_id, "text": delta.text, "final": delta.final, "lagMs": delta.lag_ms}
            ).encode()
            asyncio.run_coroutine_threadsafe(self._send(payload), self._loop)

    async def _send(self, payload: bytes) -> None:
        try:
            # Reliable: a dropped caption leaves a visible hole in the
            # text, unlike a dropped audio frame which is 20ms nobody
            # notices.
            await self.room.local_participant.publish_data(payload, reliable=True, topic=CAPTIONS_TOPIC)
        except Exception:  # noqa: BLE001
            log.debug("caption publish failed for session %s", self.session_id, exc_info=True)

    # ---- reporting -------------------------------------------------------

    def stats_payload(self) -> dict:
        return {
            "sessionId": self.session_id,
            "room": self.room_name,
            "connected": self.connected,
            "streams": [
                {
                    "lang": channel.stream.lang,
                    "state": channel.stream.state_name(),
                    "lagMs": channel.stream.observed_lag_ms(),
                    **({"error": channel.stream.error} if channel.stream.error else {}),
                }
                for channel in self.channels.values()
            ],
        }
