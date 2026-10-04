"""
Loads SeamlessStreaming once and hands out per-stream agent state.

The model is 2.5B parameters; loading it per stream is impossible on one
GPU, so a single instance is shared and each (session, language) stream
owns only its own agent STATE. That is also why the scheduler below
serialises GPU work: the weights are shared, so two streams stepping at
once would contend on the same kernels anyway.

The agents come from seamless_communication's own simuleval pipeline
(the same one `streaming_evaluate` and the official demo drive), rather
than a hand-rolled encoder/decoder loop — the monotonic decoder's
read/write policy is the hard part of simultaneous translation and
reimplementing it would change the latency/quality behaviour the model
was trained for.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from ..config import MODEL_SAMPLE_RATE, settings

# Re-exported so every caller keeps importing these from .model regardless
# of which engine is selected below.
from .base import EngineParams, ModelUnavailable, SPEECH_TARGET_LANGS  # noqa: F401

log = logging.getLogger(__name__)


class SeamlessEngine:
    """Owns the loaded model and builds per-stream agent pipelines."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._agent: Any | None = None
        self._torch: Any | None = None
        self.load_error: str | None = None
        self.device: str = "none"

    # ---- lifecycle -------------------------------------------------------

    def load(self) -> None:
        """Loads the model. Safe to call once, at startup.

        Failures are RECORDED, not raised: the service must still come up
        and answer /health with an honest reason, because the Nest server
        polls that to decide whether to offer translation at all. A
        process that refuses to boot just looks like a network outage.
        """
        if settings.disable_model:
            self.load_error = "TRANSLATOR_DISABLE_MODEL is set — no model loaded (health/API only)"
            log.warning(self.load_error)
            return
        try:
            import torch

            self._torch = torch
            if settings.device.startswith("cuda") and not torch.cuda.is_available():
                self.load_error = "CUDA requested but unavailable — refusing to load on CPU (see README)"
                log.error(self.load_error)
                return
            self.device = settings.device
            dtype = torch.float16 if settings.dtype == "fp16" else torch.float32

            # Imported lazily so the service can boot (and report why) on a
            # box where these are missing or mis-built.
            from seamless_communication.streaming.agents.seamless_streaming_s2st import (
                SeamlessStreamingS2STJointVADAgent,
            )
            from simuleval.utils.arguments import cli_argument_list
            from simuleval.agents.pipeline import TreeAgentPipeline  # noqa: F401  (used by callers)

            args = cli_argument_list(
                {
                    "task": "s2st",
                    "tgt_lang": "eng",  # per-stream; overridden in each state
                    "device": self.device,
                    "dtype": settings.dtype,
                    "source_segment_size": str(EngineParams().source_segment_size_ms),
                    "sample_rate": str(MODEL_SAMPLE_RATE),
                }
            )
            parser = SeamlessStreamingS2STJointVADAgent.add_args_to_parser()
            parsed, _unknown = parser.parse_known_args(args)
            parsed.device = self.device
            parsed.dtype = settings.dtype
            self._agent = SeamlessStreamingS2STJointVADAgent.from_args(parsed)
            log.info("SeamlessStreaming loaded on %s (%s)", self.device, dtype)
        except Exception as err:  # noqa: BLE001 — any failure must be reported, not crash boot
            self.load_error = f"{type(err).__name__}: {err}"
            log.exception("Failed to load SeamlessStreaming")

    @property
    def loaded(self) -> bool:
        return self._agent is not None

    def verify_languages(self, codes: list[str]) -> list[str]:
        """Returns the requested codes the loaded model does NOT support.

        Called once at startup against the shared catalog so a wrong
        `speech` flag in packages/shared surfaces as a logged warning here
        rather than as a stream that starts and then produces no audio.
        """
        if not self.loaded:
            return []
        return [c for c in codes if c not in SPEECH_TARGET_LANGS]

    def supports_speech(self, lang: str) -> bool:
        """Seamless synthesises only 36 of its ~96 text targets."""
        return lang in SPEECH_TARGET_LANGS

    def close_state(self, state: Any) -> None:  # noqa: ARG002
        """No-op: a Seamless state is plain tensors the GC reclaims.

        Exists so the scheduler can tear every stream down the same way
        regardless of engine — the Azure one holds a live WebSocket and
        genuinely must be closed.
        """

    def build_state(self, tgt_lang: str, params: EngineParams, *, speech: bool) -> Any:
        """A fresh agent state for one (session, language) stream.

        `speech=False` runs the s2tt task: same encoder and monotonic
        decoder, but no unit decoding or vocoder pass — roughly half the
        GPU work, which is why a caption-only language is the cheap option
        when capacity is tight.
        """
        if self._agent is None:
            raise ModelUnavailable(self.load_error or "model not loaded")
        with self._lock:
            states = self._agent.build_states()
        for state in states:
            # Per-stream overrides. Set on the state (not the shared agent)
            # so two languages can run different thresholds without one
            # stream reconfiguring another mid-sentence.
            if hasattr(state, "tgt_lang"):
                state.tgt_lang = tgt_lang
            if hasattr(state, "decision_threshold"):
                state.decision_threshold = params.decision_threshold
            if hasattr(state, "block_ngrams"):
                state.block_ngrams = True
        return states

    def push(self, states: Any, pcm_16k: Any, *, is_final: bool) -> Any:
        """Feeds one source segment and returns whatever the agent emitted.

        Holds the GPU lock for the duration: the weights are shared across
        streams, so overlapping calls would contend inside CUDA anyway and
        make both streams' latency worse than serialising them here.
        """
        if self._agent is None:
            raise ModelUnavailable(self.load_error or "model not loaded")
        from simuleval.data.segments import EmptySegment, SpeechSegment

        segment = (
            EmptySegment(finished=True)
            if is_final
            else SpeechSegment(content=pcm_16k.tolist(), sample_rate=MODEL_SAMPLE_RATE, finished=False)
        )
        with self._lock:
            return self._agent.pushpop(segment, states)

    # ---- introspection ---------------------------------------------------

    def vram(self) -> tuple[float | None, float | None]:
        """(used MB, total MB) for the GPU, or (None, None) off CUDA."""
        if self._torch is None or not self.device.startswith("cuda"):
            return None, None
        try:
            free, total = self._torch.cuda.mem_get_info()
            return (total - free) / 1024 / 1024, total / 1024 / 1024
        except Exception:  # noqa: BLE001
            return None, None

    def device_name(self) -> str | None:
        if self._torch is None or not self.device.startswith("cuda"):
            return None
        try:
            return str(self._torch.cuda.get_device_name(0))
        except Exception:  # noqa: BLE001
            return None


def _select_engine():  # noqa: ANN202
    """Picks the engine from TRANSLATOR_ENGINE.

    `stub` is imported lazily so a machine without torch/fairseq2 can
    still run the service — which is the whole point of it, since
    fairseq2n has no Windows build. Anything other than 'stub' means the
    real model.
    """
    if settings.engine == "stub":
        from .stub import StubEngine

        return StubEngine()
    if settings.engine == "azure":
        # Also lazy, and for the same reason as the stub: the Azure
        # engine must be importable on a box with no torch, no CUDA and
        # no model weights — that is the entire point of choosing it.
        from .azure import AzureEngine

        return AzureEngine()
    return SeamlessEngine()


engine = _select_engine()
