"""
Azure engine tests, driven against a stand-in Speech SDK.

The thing worth testing here is not Azure — it is the adaptation. Azure
delivers results on its own callback threads whenever they arrive, while
the rest of this service pulls synchronously via `push()`. These tests
pin that seam: a callback that fires between two pushes must surface on
the next one, a cancellation must become a loud failure rather than
silence, and teardown must actually close the recognizer.

A fake SDK (not a mock of our own code) is installed into sys.modules
before the engine imports it, so the real AzureEngine runs unmodified —
the same approach the server-side suite takes with its stand-in
translator over real HTTP.
"""

from __future__ import annotations

import sys
import types

import numpy as np
import pytest


# ---- the stand-in SDK ----------------------------------------------------


class _Signal:
    """Mimics the SDK's `recognizer.<event>.connect(handler)`."""

    def __init__(self) -> None:
        self.handlers = []

    def connect(self, handler) -> None:  # noqa: ANN001
        self.handlers.append(handler)

    def fire(self, evt) -> None:  # noqa: ANN001
        for handler in self.handlers:
            handler(evt)


class _Result:
    def __init__(self, translations=None, audio=None) -> None:  # noqa: ANN001
        self.translations = translations or {}
        self.audio = audio


class _Evt:
    def __init__(self, result=None, error_details=None) -> None:  # noqa: ANN001
        self.result = result
        self.error_details = error_details


class _PushStream:
    def __init__(self, fmt) -> None:  # noqa: ANN001, ARG002
        self.written = bytearray()
        self.closed = False

    def write(self, data: bytes) -> None:
        self.written.extend(data)

    def close(self) -> None:
        self.closed = True


class _Recognizer:
    def __init__(self, translation_config=None, audio_config=None) -> None:  # noqa: ANN001, ARG002
        self.recognizing = _Signal()
        self.recognized = _Signal()
        self.synthesizing = _Signal()
        self.canceled = _Signal()
        self.session_stopped = _Signal()
        self.started = False
        self.stopped = False

    def start_continuous_recognition_async(self):  # noqa: ANN201
        self.started = True
        return types.SimpleNamespace(get=lambda: None)

    def stop_continuous_recognition_async(self):  # noqa: ANN201
        self.stopped = True
        return types.SimpleNamespace(get=lambda: None)


class _TranslationConfig:
    def __init__(self, subscription=None, region=None) -> None:  # noqa: ANN001
        self.subscription = subscription
        self.region = region
        self.speech_recognition_language = None
        self.voice_name = None
        self.targets: list[str] = []
        self.output_format = None

    def add_target_language(self, code: str) -> None:
        self.targets.append(code)

    def set_speech_synthesis_output_format(self, fmt) -> None:  # noqa: ANN001
        self.output_format = fmt


def _install_fake_sdk(voices: list[tuple[str, str]]) -> types.ModuleType:
    """Registers a fake `azure.cognitiveservices.speech` and returns it.

    `voices` is (locale, short_name) — what the engine believes the
    region offers, which is what drives voice resolution and therefore
    whether a language gets speech or captions.
    """
    speech = types.ModuleType("azure.cognitiveservices.speech")

    class ResultReason:
        VoicesListRetrieved = "VoicesListRetrieved"

    class SpeechSynthesisOutputFormat:
        Raw16Khz16BitMonoPcm = "Raw16Khz16BitMonoPcm"

    class SpeechConfig:
        def __init__(self, subscription=None, region=None) -> None:  # noqa: ANN001
            self.subscription = subscription
            self.region = region

    class SpeechSynthesizer:
        def __init__(self, speech_config=None, audio_config=None) -> None:  # noqa: ANN001, ARG002
            pass

        def get_voices_async(self):  # noqa: ANN201
            result = types.SimpleNamespace(
                reason=ResultReason.VoicesListRetrieved,
                error_details=None,
                voices=[types.SimpleNamespace(locale=loc, short_name=name) for loc, name in voices],
            )
            return types.SimpleNamespace(get=lambda: result)

    audio_mod = types.ModuleType("azure.cognitiveservices.speech.audio")
    audio_mod.AudioStreamFormat = lambda **kw: kw  # noqa: ARG005
    audio_mod.PushAudioInputStream = _PushStream
    audio_mod.AudioConfig = lambda stream=None: stream  # noqa: ARG005

    translation_mod = types.ModuleType("azure.cognitiveservices.speech.translation")
    translation_mod.SpeechTranslationConfig = _TranslationConfig
    translation_mod.TranslationRecognizer = _Recognizer

    speech.ResultReason = ResultReason
    speech.SpeechSynthesisOutputFormat = SpeechSynthesisOutputFormat
    speech.SpeechConfig = SpeechConfig
    speech.SpeechSynthesizer = SpeechSynthesizer
    speech.audio = audio_mod
    speech.translation = translation_mod

    pkg_azure = sys.modules.setdefault("azure", types.ModuleType("azure"))
    pkg_cog = sys.modules.setdefault(
        "azure.cognitiveservices", types.ModuleType("azure.cognitiveservices")
    )
    pkg_azure.cognitiveservices = pkg_cog
    pkg_cog.speech = speech
    sys.modules["azure.cognitiveservices.speech"] = speech
    sys.modules["azure.cognitiveservices.speech.audio"] = audio_mod
    sys.modules["azure.cognitiveservices.speech.translation"] = translation_mod
    return speech


# Voices covering a language Seamless could only caption (Tamil), so the
# capability upgrade is actually asserted rather than assumed.
_VOICES = [
    ("en-IN", "en-IN-NeerjaNeural"),
    ("hi-IN", "hi-IN-SwaraNeural"),
    ("ta-IN", "ta-IN-PallaviNeural"),
]


def _with_settings(monkeypatch, **overrides):  # noqa: ANN001, ANN201
    """Swaps the engine's view of `settings`.

    Settings is a frozen dataclass, and azure.py binds the instance at
    import time (`from ..config import settings`), so the replacement has
    to land on the engine module rather than on translator.config.
    """
    import dataclasses

    import translator.engine.azure as azure_mod
    from translator.config import settings

    monkeypatch.setattr(azure_mod, "settings", dataclasses.replace(settings, **overrides))


@pytest.fixture()
def engine(monkeypatch):  # noqa: ANN001, ANN201
    _install_fake_sdk(_VOICES)
    _with_settings(
        monkeypatch,
        azure_speech_key="fake-key-not-a-real-secret",
        azure_speech_region="centralindia",
        azure_source_lang="eng",
    )
    from translator.engine.azure import AzureEngine

    eng = AzureEngine()
    eng.load()
    assert eng.loaded, eng.load_error
    return eng


def test_refuses_to_load_without_a_key(monkeypatch):  # noqa: ANN001
    """No key must be a clear 'unavailable', never a silent no-op."""
    _install_fake_sdk(_VOICES)
    _with_settings(monkeypatch, azure_speech_key=None)
    from translator.engine.azure import AzureEngine

    eng = AzureEngine()
    eng.load()
    assert not eng.loaded
    assert "AZURE_SPEECH_KEY" in (eng.load_error or "")


def test_unknown_languages_are_reported(engine):  # noqa: ANN001
    assert engine.verify_languages(["hin", "tam", "zzz"]) == ["zzz"]


def test_tamil_gets_speech_not_just_captions(engine):  # noqa: ANN001
    """The upgrade over Seamless, which can only caption Tamil."""
    assert engine.supports_speech("tam") is True
    assert engine.supports_speech("hin") is True


def test_language_without_a_voice_in_region_degrades_to_captions(engine):  # noqa: ANN001
    # Bengali is in AZURE_LANGS but absent from this region's voice list.
    assert engine.supports_speech("ben") is False


def test_recognizing_then_recognized_surface_on_next_push(engine):  # noqa: ANN001
    from translator.engine.base import EngineParams, TextOut

    state = engine.build_state("hin", EngineParams(), speech=False)
    assert state.recognizer.started

    # Nothing has arrived yet: a push must not block or invent output.
    assert engine.push(state, np.zeros(160, dtype=np.float32), is_final=False) == []

    state.recognizer.recognizing.fire(_Evt(_Result({"hi": "आप कैसे"})))
    state.recognizer.recognized.fire(_Evt(_Result({"hi": "आप कैसे हैं?"})))

    out = engine.push(state, np.zeros(160, dtype=np.float32), is_final=False)
    assert [(o.content, o.finished) for o in out if isinstance(o, TextOut)] == [
        ("आप कैसे", False),
        ("आप कैसे हैं?", True),
    ]
    # Drained, not replayed.
    assert engine.push(state, np.zeros(160, dtype=np.float32), is_final=False) == []


def test_audio_is_converted_both_ways(engine):  # noqa: ANN001
    from translator.engine.base import EngineParams, SpeechOut

    state = engine.build_state("hin", EngineParams(), speech=True)

    # Outbound: float32 -> 16-bit PCM for Azure's push stream.
    engine.push(state, np.array([0.0, 1.0, -1.0], dtype=np.float32), is_final=False)
    assert np.frombuffer(bytes(state.push_stream.written), dtype=np.int16).tolist() == [
        0,
        32767,
        -32767,
    ]

    # Inbound: Azure's raw PCM -> float32 in [-1, 1] for the playout buffer.
    state.recognizer.synthesizing.fire(
        _Evt(_Result(audio=np.array([0, 16384, -16384], dtype=np.int16).tobytes()))
    )
    speech = [o for o in engine.push(state, np.zeros(0, dtype=np.float32), is_final=False) if isinstance(o, SpeechOut)]
    assert len(speech) == 1
    assert np.allclose(speech[0].content, [0.0, 0.5, -0.5], atol=1e-4)


def test_cancellation_fails_loudly(engine):  # noqa: ANN001
    """A class that thinks it is being translated but is not is the worst
    outcome, so a cancelled Azure session must raise, not go quiet."""
    from translator.engine.base import EngineParams, ModelUnavailable

    state = engine.build_state("hin", EngineParams(), speech=True)
    state.recognizer.canceled.fire(_Evt(error_details="quota exceeded"))

    with pytest.raises(ModelUnavailable, match="quota exceeded"):
        engine.push(state, np.zeros(160, dtype=np.float32), is_final=False)


def test_close_state_releases_the_session(engine):  # noqa: ANN001
    from translator.engine.base import EngineParams

    state = engine.build_state("hin", EngineParams(), speech=True)
    recognizer, push_stream = state.recognizer, state.push_stream

    engine.close_state(state)
    assert push_stream.closed
    assert recognizer.stopped
    # Idempotent: a double close (stream removed twice) must not throw.
    engine.close_state(state)
    # And a push after close is a no-op rather than a crash.
    assert engine.push(state, np.zeros(160, dtype=np.float32), is_final=False) == []
