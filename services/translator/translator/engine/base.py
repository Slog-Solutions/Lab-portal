"""
Pieces shared by every engine implementation.

Split out of model.py so the stub engine can be imported without pulling
in torch/fairseq2 — which matters because fairseq2n, the native half of
fairseq2, has no Windows distribution at all. On a Windows dev box the
real engine is not merely slow, it cannot be installed, so the stub is
the only way to exercise the pipeline there.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: Seamless target languages that can be SYNTHESISED (S2ST). Everything
#: else the model supports is text-only; a caption-only stream runs the
#: cheaper s2tt task. Kept here (not in model.py) so the stub can report
#: the same capability split without importing torch.
SPEECH_TARGET_LANGS = frozenset(
    {
        "arb", "ben", "cat", "ces", "cmn", "cym", "dan", "deu", "eng", "est",
        "fin", "fra", "hin", "ind", "ita", "jpn", "kor", "mlt", "nld", "pes",
        "pol", "por", "ron", "rus", "slk", "spa", "swe", "swh", "tel", "tgl",
        "tha", "tur", "ukr", "urd", "uzn", "vie",
    }
)


@dataclass
class EngineParams:
    source_segment_size_ms: int = 320
    decision_threshold: float = 0.5
    min_starting_wait_ms: int = 576
    catch_up_start_ms: int = 1500
    max_catch_up_rate: float = 1.15
    drop_backlog_ms: int = 5000

    @staticmethod
    def from_payload(payload: dict[str, Any] | None) -> "EngineParams":
        if not payload:
            return EngineParams()
        d = EngineParams()
        return EngineParams(
            source_segment_size_ms=int(payload.get("sourceSegmentSizeMs", d.source_segment_size_ms)),
            decision_threshold=float(payload.get("decisionThreshold", d.decision_threshold)),
            min_starting_wait_ms=int(payload.get("minStartingWaitMs", d.min_starting_wait_ms)),
            catch_up_start_ms=int(payload.get("catchUpStartMs", d.catch_up_start_ms)),
            max_catch_up_rate=float(payload.get("maxCatchUpRate", d.max_catch_up_rate)),
            drop_backlog_ms=int(payload.get("dropBacklogMs", d.drop_backlog_ms)),
        )


class ModelUnavailable(RuntimeError):
    """Raised when a translate request arrives but no model is loaded.

    Deliberately an error rather than a silent no-op: a class that thinks
    it is being translated but is not is worse than one told plainly that
    translation is down (the server then falls back to the teacher's own
    audio and tells the student why).
    """


@dataclass
class TextOut:
    """Mirrors the shape of simuleval's text segment, for the stub."""

    content: str
    finished: bool = False
    data_type: str = "text"


@dataclass
class SpeechOut:
    """Mirrors the shape of simuleval's speech segment, for the stub."""

    content: Any
    finished: bool = False
    data_type: str = "speech"
