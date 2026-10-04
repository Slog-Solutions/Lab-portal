"""
Translation Lab test runs.

`realtime` deliberately reuses the live pipeline: the file is decoded,
paced at 1x into the same TranslationStream/PlayoutBuffer the classroom
uses, and published into a throwaway LiveKit room the teacher auditions.
Measuring anything else would answer the wrong question — the point is
the latency a student experiences, not how fast the GPU can chew a file.

`fast` skips the pacing and the room: same streams, fed as quickly as the
GPU accepts them. Useful for judging translation quality without sitting
through a ten-minute clip, and explicitly NOT a latency measurement.
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
from livekit import rtc

from .config import FRAME_MS, MODEL_SAMPLE_RATE, OUTPUT_SAMPLE_RATE
from .engine.model import EngineParams
from .engine.scheduler import scheduler
from .engine.stream import TranslationStream

log = logging.getLogger(__name__)

SOURCE_TRACK = "src"
CAPTIONS_TOPIC = "tr:captions"
FRAME_SAMPLES_OUT = OUTPUT_SAMPLE_RATE * FRAME_MS // 1000
FRAME_SAMPLES_IN = MODEL_SAMPLE_RATE * FRAME_MS // 1000


@dataclass
class TestRun:
    run_id: str
    status: str = "queued"
    error: str | None = None
    duration_ms: int | None = None
    metrics: dict = field(default_factory=dict)
    task: asyncio.Task | None = None


_runs: dict[str, TestRun] = {}


def get_run(run_id: str) -> TestRun | None:
    return _runs.get(run_id)


def decode_to_mono16k(path: Path) -> np.ndarray:
    """Any audio/video container to float32 mono at the model's rate.

    ffmpeg rather than soundfile alone: teachers upload mp3, m4a, mp4 and
    whatever else their phone produced, and libsndfile reads almost none
    of those.
    """
    proc = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-i", str(path),
            "-f", "f32le", "-ac", "1", "-ar", str(MODEL_SAMPLE_RATE),
            "-",
        ],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg could not decode the upload: {proc.stderr.decode(errors='replace')[:400]}")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


async def start_test_run(
    *,
    run_id: str,
    audio_path: str,
    source_language: str,
    target_languages: list[str],
    mode: str,
    params: EngineParams,
    output_dir: str,
    room: str | None,
    livekit_url: str | None,
    token: str | None,
) -> TestRun:
    run = TestRun(run_id=run_id, status="running")
    _runs[run_id] = run
    run.task = asyncio.create_task(
        _execute(
            run=run,
            audio_path=Path(audio_path),
            source_language=source_language,
            target_languages=target_languages,
            mode=mode,
            params=params,
            output_dir=Path(output_dir),
            room=room,
            livekit_url=livekit_url,
            token=token,
        ),
        name=f"testrun-{run_id}",
    )
    return run


async def cancel_test_run(run_id: str) -> None:
    run = _runs.get(run_id)
    if run is None or run.task is None:
        return
    run.task.cancel()
    try:
        await run.task
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass
    scheduler.remove_session(f"trtest:{run_id}")


async def _execute(
    *,
    run: TestRun,
    audio_path: Path,
    source_language: str,
    target_languages: list[str],
    mode: str,
    params: EngineParams,
    output_dir: Path,
    room: str | None,
    livekit_url: str | None,
    token: str | None,
) -> None:
    session_id = f"trtest:{run.run_id}"
    began = time.perf_counter()
    streams: dict[str, TranslationStream] = {}
    captions: dict[str, list[dict]] = {lang: [] for lang in target_languages}
    lk_room: rtc.Room | None = None
    sources: dict[str, rtc.AudioSource] = {}
    pump_tasks: list[asyncio.Task] = []

    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        audio = decode_to_mono16k(audio_path)
        if audio.size == 0:
            raise RuntimeError("the uploaded file contains no audio")

        def sink(lang: str, deltas) -> None:  # noqa: ANN001
            for delta in deltas:
                captions[lang].append(
                    {"segId": delta.seg_id, "text": delta.text, "final": delta.final, "lagMs": delta.lag_ms}
                )
                if lk_room is not None:
                    payload = json.dumps(
                        {"lang": lang, "segId": delta.seg_id, "text": delta.text, "final": delta.final, "lagMs": delta.lag_ms}
                    ).encode()
                    asyncio.run_coroutine_threadsafe(_send(lk_room, payload), loop)

        loop = asyncio.get_running_loop()
        for lang in target_languages:
            stream = TranslationStream(lang=lang, params=params)
            streams[lang] = stream
            scheduler.add(session_id, stream, lambda deltas, l=lang: sink(l, deltas))

        recorders: dict[str, list[np.ndarray]] = {lang: [] for lang in streams}

        # Real-time mode publishes into a room the teacher listens in, so
        # they hear the original and the translations exactly as a student
        # would — including the playout buffer's catch-up behaviour.
        if mode == "realtime" and room and livekit_url and token:
            lk_room = rtc.Room()
            await lk_room.connect(livekit_url, token, rtc.RoomOptions(auto_subscribe=False))
            src_source = rtc.AudioSource(OUTPUT_SAMPLE_RATE, 1)
            # Track name comes from create_audio_track, never from
            # TrackPublishOptions (which has no `name` field and raises).
            src_track = rtc.LocalAudioTrack.create_audio_track(SOURCE_TRACK, src_source)
            await lk_room.local_participant.publish_track(
                src_track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
            )
            sources[SOURCE_TRACK] = src_source
            for lang, stream in streams.items():
                if stream.playout is None:
                    continue  # caption-only language publishes no audio
                source = rtc.AudioSource(OUTPUT_SAMPLE_RATE, 1)
                track = rtc.LocalAudioTrack.create_audio_track(f"tr:{lang}", source)
                await lk_room.local_participant.publish_track(
                    track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
                )
                sources[lang] = source

        # One pump per speech language in BOTH modes — it is what drains
        # the playout buffer and records the WAV; only `source` differs.
        for lang, stream in streams.items():
            if stream.playout is None:
                continue
            pump_tasks.append(
                asyncio.create_task(_pump(stream, recorders[lang], sources.get(lang)), name=f"testrun-pump-{lang}")
            )

        # Feed the file. Real-time paces at 1x (and publishes the original
        # as it goes); fast mode hands the whole file over as fast as the
        # scheduler will take it.
        if mode == "realtime":
            await _feed_paced(audio, streams, sources.get(SOURCE_TRACK))
        else:
            await _feed_fast(audio, streams)

        # Flush: tell every stream the source ended, then let the
        # scheduler finish what is queued and the pumps drain the tail
        # (mark_drained means that happens at 1x, uncut).
        for stream in streams.values():
            stream.step(is_final=True)
        await _await_drain(streams)

        for task in pump_tasks:
            task.cancel()
        for task in pump_tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
        pump_tasks.clear()

        run.metrics = _write_outputs(output_dir, streams, captions, recorders, mode)
        run.duration_ms = int((time.perf_counter() - began) * 1000)
        failed = [lang for lang, s in streams.items() if s.error]
        if failed:
            run.status = "failed"
            run.error = "; ".join(f"{lang}: {streams[lang].error}" for lang in failed)
        else:
            run.status = "done"
    except asyncio.CancelledError:
        run.status = "failed"
        run.error = "cancelled"
        raise
    except Exception as err:  # noqa: BLE001
        run.status = "failed"
        run.error = f"{type(err).__name__}: {err}"
        log.exception("test run %s failed", run.run_id)
    finally:
        for task in pump_tasks:
            task.cancel()
        scheduler.remove_session(session_id)
        for source in sources.values():
            try:
                await source.aclose()
            except Exception:  # noqa: BLE001
                pass
        if lk_room is not None:
            try:
                await lk_room.disconnect()
            except Exception:  # noqa: BLE001
                pass


async def _send(room: rtc.Room, payload: bytes) -> None:
    try:
        await room.local_participant.publish_data(payload, reliable=True, topic=CAPTIONS_TOPIC)
    except Exception:  # noqa: BLE001
        pass


async def _pump(
    stream: TranslationStream,
    recorder: list[np.ndarray],
    source: rtc.AudioSource | None,
) -> None:
    """Drains one stream's playout buffer at the 20ms wall clock.

    This is the ONLY consumer of a playout buffer in a test run, so it is
    also where the saved WAV comes from — recording anything else (the raw
    model output, say) would save audio the teacher never heard, with none
    of the catch-up or silence-fill that shapes what a student actually
    gets. `source` is None in fast mode: same drain, no publishing.
    """
    if stream.playout is None:
        return
    interval = FRAME_MS / 1000
    next_at = asyncio.get_running_loop().time()
    while True:
        samples = stream.playout.next_frame()
        recorder.append(samples.copy())
        if source is not None:
            frame = rtc.AudioFrame(
                data=(np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes(),
                sample_rate=OUTPUT_SAMPLE_RATE,
                num_channels=1,
                samples_per_channel=FRAME_SAMPLES_OUT,
            )
            try:
                await source.capture_frame(frame)
            except Exception:  # noqa: BLE001
                return
        next_at += interval
        delay = next_at - asyncio.get_running_loop().time()
        if delay > 0:
            await asyncio.sleep(delay)
        else:
            # In fast mode there is no publishing to pace against, so the
            # loop would spin; yield and resync either way.
            await asyncio.sleep(0)
            next_at = asyncio.get_running_loop().time()


async def _feed_paced(
    audio: np.ndarray,
    streams: dict[str, TranslationStream],
    src_source: rtc.AudioSource | None,
) -> None:
    interval = FRAME_MS / 1000
    next_at = asyncio.get_running_loop().time()
    for offset in range(0, len(audio), FRAME_SAMPLES_IN):
        chunk = audio[offset : offset + FRAME_SAMPLES_IN]
        if chunk.size < FRAME_SAMPLES_IN:
            chunk = np.pad(chunk, (0, FRAME_SAMPLES_IN - chunk.size))
        for stream in streams.values():
            stream.feed(chunk)
        if src_source is not None:
            out = soxr.resample(chunk, MODEL_SAMPLE_RATE, OUTPUT_SAMPLE_RATE)
            frame = rtc.AudioFrame(
                data=(np.clip(out, -1, 1) * 32767).astype(np.int16).tobytes(),
                sample_rate=OUTPUT_SAMPLE_RATE,
                num_channels=1,
                samples_per_channel=len(out),
            )
            try:
                await src_source.capture_frame(frame)
            except Exception:  # noqa: BLE001
                pass
        next_at += interval
        delay = next_at - asyncio.get_running_loop().time()
        await asyncio.sleep(delay if delay > 0 else 0)


async def _feed_fast(audio: np.ndarray, streams: dict[str, TranslationStream]) -> None:
    for offset in range(0, len(audio), FRAME_SAMPLES_IN * 25):  # ~500ms at a time
        chunk = audio[offset : offset + FRAME_SAMPLES_IN * 25]
        for stream in streams.values():
            stream.feed(chunk)
        # Yield so the scheduler thread can keep up and the buffers do not
        # grow to hold the entire file.
        while any(s.backlog_ms() > 3000 for s in streams.values()):
            await asyncio.sleep(0.02)
        await asyncio.sleep(0)


async def _await_drain(streams: dict[str, TranslationStream], timeout_s: float = 120) -> None:
    deadline = asyncio.get_running_loop().time() + timeout_s
    while asyncio.get_running_loop().time() < deadline:
        if all(not s.ready() for s in streams.values()):
            return
        await asyncio.sleep(0.05)
    log.warning("test run drain timed out with audio still queued")


def _write_outputs(
    output_dir: Path,
    streams: dict[str, TranslationStream],
    captions: dict[str, list[dict]],
    recorders: dict[str, list[np.ndarray]],
    mode: str,
) -> dict:
    """Saves per-language audio and transcripts, and returns the metrics."""
    langs_payload: dict[str, dict] = {}
    total_gpu = 0.0
    total_source = 0.0
    for lang, stream in streams.items():
        payload = stream.stats.to_payload()
        total_gpu += stream.stats.gpu_seconds
        total_source += stream.stats.source_seconds
        # Caption-only languages have no audio to save; their transcript
        # is the whole output.
        if stream.playout is not None and recorders.get(lang):
            audio = np.concatenate(recorders[lang])
            sf.write(output_dir / f"{lang}.wav", audio, OUTPUT_SAMPLE_RATE, subtype="PCM_16")
        (output_dir / f"{lang}.json").write_text(
            json.dumps({"lang": lang, "mode": mode, "captions": captions.get(lang, []), **payload}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        langs_payload[lang] = payload
    return {
        "rtf": (total_gpu / total_source) if total_source > 0 else None,
        "mode": mode,
        "langs": langs_payload,
    }
