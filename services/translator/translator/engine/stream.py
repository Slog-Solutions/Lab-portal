"""
One (session, language) translation stream.

Owns an agent state, the source-audio accumulator feeding it, the
playout buffer its synthesised speech drains into, and the caption
segment numbering. Everything about timing is tracked against the SOURCE
clock (how many ms of the teacher's audio have been consumed), because
that is what "lag" means to a student: the gap between the teacher
saying a word and them hearing or reading it.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import numpy as np
import soxr

from ..config import MODEL_SAMPLE_RATE, OUTPUT_SAMPLE_RATE
from .model import EngineParams, SPEECH_TARGET_LANGS, engine
from .playout import PlayoutBuffer

log = logging.getLogger(__name__)


@dataclass
class TextDelta:
    seg_id: int
    text: str
    final: bool
    lag_ms: int


@dataclass
class StreamStats:
    caption_lags_ms: list[int] = field(default_factory=list)
    speech_lags_ms: list[int] = field(default_factory=list)
    segments: int = 0
    gpu_seconds: float = 0.0
    source_seconds: float = 0.0
    transcript_parts: list[str] = field(default_factory=list)

    def percentile(self, values: list[int], p: float) -> float | None:
        if not values:
            return None
        return float(np.percentile(np.asarray(values, dtype=np.float64), p))

    def to_payload(self) -> dict:
        return {
            "captionLagP50": self.percentile(self.caption_lags_ms, 50),
            "captionLagP95": self.percentile(self.caption_lags_ms, 95),
            "speechLagP50": self.percentile(self.speech_lags_ms, 50),
            "speechLagP95": self.percentile(self.speech_lags_ms, 95),
            "segments": self.segments,
            "transcript": " ".join(self.transcript_parts).strip(),
        }


class TranslationStream:
    """Not thread-safe by itself — the scheduler owns when `step` runs."""

    def __init__(self, *, lang: str, params: EngineParams, source_lang: str = "eng") -> None:
        self.lang = lang
        self.params = params
        # The language being SPOKEN, per session — the teacher is not
        # assumed to teach in any particular one. Seamless ignores it (its
        # encoder is multilingual and the agent is built for tgt_lang
        # only); Azure needs it up front to pick the recognition locale.
        self.source_lang = source_lang
        # A language the model cannot synthesise runs captions-only. Same
        # encoder and monotonic decoder, no unit decoder or vocoder: about
        # half the GPU work, and the honest thing to offer rather than
        # pretending there will be audio.
        # Asked of the engine rather than read from SPEECH_TARGET_LANGS
        # directly: that set is Seamless's 36-language S2ST list, while
        # Azure has a voice for every language it translates. Letting the
        # engine answer is what lets Tamil/Punjabi/Gujarati carry real
        # audio on Azure instead of being stuck caption-only.
        self.speech = engine.supports_speech(lang)
        self.state = engine.build_state(lang, params, speech=self.speech, source_lang=source_lang)
        self.playout = (
            PlayoutBuffer(
                catch_up_start_ms=params.catch_up_start_ms,
                max_catch_up_rate=params.max_catch_up_rate,
                drop_backlog_ms=params.drop_backlog_ms,
            )
            if self.speech
            else None
        )
        self.stats = StreamStats()
        self.error: str | None = None

        self._pending = np.zeros(0, dtype=np.float32)
        self._segment_samples = MODEL_SAMPLE_RATE * params.source_segment_size_ms // 1000
        self._min_start_samples = MODEL_SAMPLE_RATE * params.min_starting_wait_ms // 1000
        self._started = False
        #: Source audio consumed so far, in ms — the clock every lag number
        #: is measured against.
        self._source_ms = 0
        self._seg_id = 0
        self._seg_text = ""
        self._pending_deltas: list[TextDelta] = []

    # ---- input -----------------------------------------------------------

    def feed(self, pcm_16k: np.ndarray) -> None:
        """Queues source audio. Already resampled to MODEL_SAMPLE_RATE."""
        self._pending = np.concatenate([self._pending, pcm_16k.astype(np.float32, copy=False)])

    def ready(self) -> bool:
        """Whether a full source segment is queued and the model may start."""
        if self.error is not None:
            return False
        if not self._started and len(self._pending) < self._min_start_samples:
            # The model needs some context before its first emission; this
            # is the one place latency is deliberately spent, because
            # committing too early is what produces word-order nonsense in
            # languages that reorder relative to English.
            return False
        return len(self._pending) >= self._segment_samples

    def backlog_ms(self) -> int:
        """How much un-translated source audio is queued."""
        return int(len(self._pending) / MODEL_SAMPLE_RATE * 1000)

    # ---- one GPU step ----------------------------------------------------

    def step(self, *, is_final: bool = False) -> list[TextDelta]:
        """Consumes one source segment. Returns caption deltas produced."""
        if self.error is not None:
            return []
        take = min(self._segment_samples, len(self._pending))
        if take == 0 and not is_final:
            return []
        chunk = self._pending[:take]
        self._pending = self._pending[take:]
        self._started = True

        began = time.perf_counter()
        try:
            output = engine.push(self.state, chunk, is_final=is_final)
        except Exception as err:  # noqa: BLE001 — one stream failing must not take the class down
            self.error = f"{type(err).__name__}: {err}"
            log.exception("stream %s failed", self.lang)
            return []
        gpu_s = time.perf_counter() - began

        self.stats.gpu_seconds += gpu_s
        self._source_ms += int(take / MODEL_SAMPLE_RATE * 1000)
        self.stats.source_seconds += take / MODEL_SAMPLE_RATE

        self._pending_deltas = []
        if output is not None:
            self._absorb(output, is_final=is_final)
        if is_final and self.playout is not None:
            self.playout.mark_drained()
        return self._pending_deltas

    def _absorb(self, output, *, is_final: bool) -> None:
        """Turns one agent output into caption deltas and playout audio."""
        segments = output if isinstance(output, list) else [output]
        for segment in segments:
            content = getattr(segment, "content", None)
            if content is None:
                continue
            data_type = getattr(segment, "data_type", None)

            if data_type == "text" or isinstance(content, str):
                text = content if isinstance(content, str) else str(content)
                if not text.strip():
                    continue
                # Within a segment the model only ever appends, so the
                # delta carries the whole segment text and the client
                # keyed by seg_id replaces rather than concatenating —
                # that is what keeps captions from flickering or doubling.
                self._seg_text = f"{self._seg_text} {text}".strip() if self._seg_text else text
                final = bool(getattr(segment, "finished", False)) or is_final
                lag = self._lag_ms()
                self._pending_deltas.append(TextDelta(self._seg_id, self._seg_text, final, lag))
                self.stats.caption_lags_ms.append(lag)
                if final:
                    self.stats.segments += 1
                    self.stats.transcript_parts.append(self._seg_text)
                    self._seg_id += 1
                    self._seg_text = ""

            elif self.playout is not None:
                # Synthesised speech, at the model's rate. Resampled once
                # here to WebRTC's 48k so neither the playout buffer nor
                # libwebrtc has to do it per frame.
                samples = np.asarray(content, dtype=np.float32).reshape(-1)
                if samples.size == 0:
                    continue
                resampled = soxr.resample(samples, MODEL_SAMPLE_RATE, OUTPUT_SAMPLE_RATE)
                self.playout.write(resampled)
                self.stats.speech_lags_ms.append(self._lag_ms() + self.playout.backlog_ms())

    def _lag_ms(self) -> int:
        """Lag of what was just emitted behind the teacher's live speech:
        the audio still waiting to be consumed."""
        return self.backlog_ms()

    # ---- reporting -------------------------------------------------------

    def close(self) -> None:
        """Releases whatever the engine state holds.

        A no-op for the local engines, but the Azure one owns a live
        recognizer and WebSocket that would otherwise stay open — and
        keep billing — until the process exits.
        """
        try:
            engine.close_state(self.state)
        except Exception:  # noqa: BLE001 — teardown must not break removal
            log.debug("closing state for %s failed", self.lang, exc_info=True)

    def observed_lag_ms(self) -> int | None:
        if self.error is not None:
            return None
        base = self.backlog_ms()
        return base + (self.playout.backlog_ms() if self.playout is not None else 0)

    def state_name(self) -> str:
        if self.error is not None:
            return "error"
        if not self._started:
            # 'starting' until the model has actually consumed audio, NOT
            # merely until the track is published — and that distinction
            # is load-bearing. The student console only mutes the
            # teacher's own voice on 'ready' (see shouldMuteOriginal), so
            # reporting 'live' the moment the track exists would leave a
            # student in silence for the seconds the model spends warming
            # up. A silent teacher therefore shows 'starting' indefinitely,
            # which is honest: nothing is being translated because nothing
            # is being said, and the teacher stays audible throughout.
            return "starting"
        # 'degraded' is reported rather than hidden so the teacher's
        # console can show it: audio is still flowing, just late.
        lag = self.observed_lag_ms() or 0
        return "degraded" if lag > self.params.drop_backlog_ms else "live"
