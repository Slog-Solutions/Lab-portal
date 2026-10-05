"""
TranslationStream caption assembly, against a scripted engine.

Pins the bug students saw as captions repeating every prefix ("haan
kyonki haan kyonki maine hindi ..."): Azure re-sends the whole hypothesis
on each partial, and the stream used to append each one.
"""

from __future__ import annotations

import numpy as np
import pytest

from translator.config import MODEL_SAMPLE_RATE
from translator.engine import stream as stream_mod
from translator.engine.base import EngineParams, TextOut


class _ScriptedEngine:
    """Returns the next scripted output on each push."""

    def __init__(self, outputs: list[list[TextOut]], tuned: EngineParams | None = None) -> None:
        self._outputs = list(outputs)
        self._tuned = tuned

    def supports_speech(self, lang: str) -> bool:  # noqa: ARG002
        return False

    def build_state(self, *args, **kwargs):  # noqa: ANN002, ANN003, ANN201, ARG002
        return object()

    def push(self, state, pcm, *, is_final: bool):  # noqa: ANN001, ANN201, ARG002
        return self._outputs.pop(0) if self._outputs else []

    def close_state(self, state) -> None:  # noqa: ANN001, ARG002
        pass


def _run(monkeypatch, outputs: list[list[TextOut]]) -> list[str]:  # noqa: ANN001
    monkeypatch.setattr(stream_mod, "engine", _ScriptedEngine(outputs))
    s = stream_mod.TranslationStream(lang="eng", params=EngineParams())
    texts: list[str] = []
    chunk = np.zeros(int(MODEL_SAMPLE_RATE * EngineParams().source_segment_size_ms / 1000), dtype=np.float32)
    for _ in outputs:
        s.feed(chunk)
        texts.extend(d.text for d in s.step())
    return texts


def test_full_hypothesis_partials_replace_the_segment(monkeypatch):  # noqa: ANN001
    texts = _run(
        monkeypatch,
        [
            [TextOut("because", finished=False, replace=True)],
            [TextOut("because I", finished=False, replace=True)],
            [TextOut("because I want English", finished=True, replace=True)],
        ],
    )
    assert texts == ["because", "because I", "because I want English"]


def test_token_deltas_still_append(monkeypatch):  # noqa: ANN001
    """Seamless sends only new words; that path must keep appending."""
    texts = _run(
        monkeypatch,
        [
            [TextOut("because", finished=False)],
            [TextOut("I want", finished=False)],
            [TextOut("English", finished=True)],
        ],
    )
    assert texts == ["because", "because I want", "because I want English"]


def test_engine_can_tune_playout(monkeypatch):  # noqa: ANN001
    class _Tuning(_ScriptedEngine):
        def supports_speech(self, lang: str) -> bool:  # noqa: ARG002
            return True

        def tune_params(self, params: EngineParams) -> EngineParams:
            import dataclasses

            return dataclasses.replace(params, drop_backlog_ms=30000)

    monkeypatch.setattr(stream_mod, "engine", _Tuning([]))
    s = stream_mod.TranslationStream(lang="eng", params=EngineParams())
    assert s.params.drop_backlog_ms == 30000
    assert s.playout is not None and s.playout._drop_backlog_ms == 30000  # noqa: SLF001


@pytest.mark.parametrize("missing", ["tune_params"])
def test_engines_without_tuning_use_shared_params(monkeypatch, missing):  # noqa: ANN001, ARG001
    monkeypatch.setattr(stream_mod, "engine", _ScriptedEngine([]))
    s = stream_mod.TranslationStream(lang="eng", params=EngineParams())
    assert s.params == EngineParams()
