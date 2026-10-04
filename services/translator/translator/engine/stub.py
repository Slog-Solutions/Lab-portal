"""
A stub engine: everything except the actual translation.

Why this exists. SeamlessStreaming needs fairseq2, whose native half
(`fairseq2n`) ships no Windows distribution, and needs ~5GB of VRAM for
its weights. On a Windows dev box, or any machine without a big enough
GPU, the real engine cannot run at all — so without this there would be
no way to exercise the other 95% of the feature: token minting, room
join, source-track binding, the GPU scheduler, the playout buffer,
per-language track publishing, the subscription filter, caption delivery,
language switching, the teacher's status row, and the whole Translation
Lab path.

What it does instead of translating:
  * **Captions** — emits a real caption segment on the real data channel
    every few hundred ms of speech, numbered and timestamped, so segment
    replacement, lag reporting and the caption UI are all genuinely
    driven. The text says it is a stub; it is never passed off as a
    translation.
  * **Audio** — returns the teacher's own audio, ring-modulated at a
    frequency derived from the target language. Same duration (so the
    playout buffer's timing behaviour is real), but unmistakably robotic
    and *different per language* — which is exactly what you need to hear
    to confirm that picking Hindi versus Bengali actually switches which
    track you are subscribed to.

It is never a substitute for measuring real latency: an RTF from this
engine says nothing about the GPU. Set TRANSLATOR_ENGINE=seamless for
anything that matters.
"""

from __future__ import annotations

import logging
import time

import numpy as np

from ..config import MODEL_SAMPLE_RATE
from .base import SPEECH_TARGET_LANGS, EngineParams, ModelUnavailable, SpeechOut, TextOut

log = logging.getLogger(__name__)

#: How much speech accumulates before the stub emits a caption segment.
#: Roughly what a real simultaneous model commits in one go, so the
#: caption cadence on screen looks like the real thing.
_SEGMENT_MS = 900

#: Silence below this RMS is treated as "not speech", so captions don't
#: tick along while nobody is talking.
_SILENCE_RMS = 0.004


def _carrier_hz(lang: str) -> float:
    """A distinct ring-mod frequency per language.

    Deterministic from the code so the same language always sounds the
    same across restarts, and spread over a range that stays clearly
    audible without destroying intelligibility.
    """
    return 110.0 + (sum(ord(c) for c in lang) % 13) * 25.0


class _StubState:
    def __init__(self, lang: str, speech: bool) -> None:
        self.lang = lang
        self.speech = speech
        self.carrier_hz = _carrier_hz(lang)
        #: Phase carried across chunks so the carrier is continuous — a
        #: per-chunk reset would click at every 320ms boundary.
        self.phase = 0.0
        self.voiced_ms = 0
        self.seg_index = 0
        self.total_ms = 0


class StubEngine:
    """Same surface as SeamlessEngine, no torch, no GPU, no weights."""

    def __init__(self) -> None:
        self.load_error: str | None = None
        self.device = "stub"
        self._loaded = False

    # ---- lifecycle -------------------------------------------------------

    def load(self) -> None:
        self._loaded = True
        log.warning(
            "TRANSLATOR_ENGINE=stub — captions are placeholder text and translated audio is "
            "the teacher's own voice ring-modulated per language. Pipeline only; NOT a translation."
        )

    @property
    def loaded(self) -> bool:
        return self._loaded

    def verify_languages(self, codes: list[str]) -> list[str]:
        # The stub can "handle" anything; report nothing missing so the
        # catalog check doesn't warn misleadingly.
        return []

    def supports_speech(self, lang: str) -> bool:
        # Mirrors the real model's capability split so the stub exercises
        # the same caption-only vs speech paths the UI has to handle.
        return lang in SPEECH_TARGET_LANGS

    def close_state(self, state) -> None:  # noqa: ANN001, ARG002
        """No-op; see SeamlessEngine.close_state."""

    def build_state(self, tgt_lang: str, params: EngineParams, *, speech: bool, source_lang: str = "eng"):  # noqa: ANN201, ARG002
        if not self._loaded:
            raise ModelUnavailable("stub engine not loaded")
        return _StubState(tgt_lang, speech)

    # ---- the "translation" ----------------------------------------------

    def push(self, states, pcm_16k, *, is_final: bool):  # noqa: ANN001, ANN201
        if not self._loaded:
            raise ModelUnavailable("stub engine not loaded")
        state: _StubState = states
        out: list[TextOut | SpeechOut] = []

        if is_final:
            # Flush whatever segment was in progress, so the last clause
            # is marked final rather than left hanging.
            if state.voiced_ms > 0:
                out.append(TextOut(content=self._caption(state, final=True), finished=True))
                state.voiced_ms = 0
                state.seg_index += 1
            return out

        samples = np.asarray(pcm_16k, dtype=np.float32).reshape(-1)
        if samples.size == 0:
            return out

        chunk_ms = int(samples.size / MODEL_SAMPLE_RATE * 1000)
        state.total_ms += chunk_ms
        rms = float(np.sqrt(np.mean(samples * samples)))

        # Captions only advance on actual speech, mirroring how a real
        # streaming model behaves with a VAD in front of it.
        if rms >= _SILENCE_RMS:
            state.voiced_ms += chunk_ms
            if state.voiced_ms >= _SEGMENT_MS:
                out.append(TextOut(content=self._caption(state, final=True), finished=True))
                state.voiced_ms = 0
                state.seg_index += 1
            else:
                # A partial revision of the current segment, which is what
                # exercises the client's replace-by-segId path.
                out.append(TextOut(content=self._caption(state, final=False), finished=False))

        if state.speech:
            out.append(SpeechOut(content=self._ring_mod(state, samples)))
        return out

    def _caption(self, state: _StubState, *, final: bool) -> str:
        secs = state.total_ms / 1000
        tail = "" if final else " …"
        return f"[stub·{state.lang}] segment {state.seg_index + 1} at {secs:0.1f}s{tail}"

    def _ring_mod(self, state: _StubState, samples: np.ndarray) -> np.ndarray:
        """Ring-modulates in place of synthesising speech.

        Chosen over a pitch shift because resampling would change the
        chunk's DURATION, which would make the playout buffer's backlog
        grow or shrink for a reason the real engine never produces — and
        the point of the stub is that the timing behaviour stays real.
        """
        n = samples.size
        step = 2.0 * np.pi * state.carrier_hz / MODEL_SAMPLE_RATE
        phases = state.phase + step * np.arange(n, dtype=np.float32)
        state.phase = float((phases[-1] + step) % (2.0 * np.pi))
        # 0.65 carrier + 0.35 passthrough keeps the words recognisable
        # while making it obvious this is not the original channel.
        return (samples * (0.65 * np.sin(phases) + 0.35)).astype(np.float32)

    # ---- introspection ---------------------------------------------------

    def vram(self) -> tuple[float | None, float | None]:
        return None, None

    def device_name(self) -> str | None:
        return "stub engine (no model)"
