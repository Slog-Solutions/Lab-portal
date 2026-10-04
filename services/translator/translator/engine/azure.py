"""
Azure Speech translation engine.

Azure does speech-to-speech in ONE call: `TranslationRecognizer` consumes
microphone-rate PCM and emits both the translated text and, when a voice
is configured, the synthesised audio for it. So unlike a
STT -> translate -> TTS cascade there is no sentence-boundary buffering
here and no second network hop before audio starts.

Shape of the adaptation. The rest of this service drives engines
synchronously: `push(state, pcm) -> [segments]`, called from the
scheduler loop. Azure is the opposite — a background SDK thread fires
`recognizing` / `recognized` / `synthesizing` callbacks whenever results
arrive. Each state therefore owns a queue: callbacks append to it, and
`push()` feeds the audio in and then drains whatever has shown up so
far. `push()` never blocks on the network, which is what keeps one slow
language from stalling the others.

One recognizer per (session, language). Azure only synthesises when a
recognizer has exactly one target language, and this service already
builds one stream per language, so the two line up. The cost to know
about: every language recognises the same audio again, so four languages
bill four times the audio-hours. Fixing that means one shared recognizer
feeding many languages' text and separate synthesis, which is a larger
change to session.py than this engine swap.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..config import MODEL_SAMPLE_RATE, settings
from .base import EngineParams, ModelUnavailable, SpeechOut, TextOut

log = logging.getLogger(__name__)

#: ISO-639-3 (what this service speaks internally, see
#: packages/shared/src/translation/languages.ts) -> Azure's codes.
#:
#: `locale` is the speech-recognition locale, used when the language is
#: the SOURCE. `target` is the translation code, used when it is a
#: TARGET. `voice` is the preferred neural voice for synthesis — it is
#: only a preference: _resolve_voice checks it against the voice list
#: Azure itself reports at load time and falls back to another voice for
#: the same locale rather than failing, so a renamed or retired voice
#: degrades instead of breaking a class.
AZURE_LANGS: dict[str, dict[str, str]] = {
    "eng": {"locale": "en-IN", "target": "en", "voice": "en-IN-NeerjaNeural"},
    "hin": {"locale": "hi-IN", "target": "hi", "voice": "hi-IN-SwaraNeural"},
    "ben": {"locale": "bn-IN", "target": "bn", "voice": "bn-IN-TanishaaNeural"},
    "tel": {"locale": "te-IN", "target": "te", "voice": "te-IN-ShrutiNeural"},
    "tam": {"locale": "ta-IN", "target": "ta", "voice": "ta-IN-PallaviNeural"},
    "mar": {"locale": "mr-IN", "target": "mr", "voice": "mr-IN-AarohiNeural"},
    "guj": {"locale": "gu-IN", "target": "gu", "voice": "gu-IN-DhwaniNeural"},
    "kan": {"locale": "kn-IN", "target": "kn", "voice": "kn-IN-SapnaNeural"},
    "mal": {"locale": "ml-IN", "target": "ml", "voice": "ml-IN-SobhanaNeural"},
    "pan": {"locale": "pa-IN", "target": "pa", "voice": "pa-IN-VaaniNeural"},
    "urd": {"locale": "ur-IN", "target": "ur", "voice": "ur-IN-GulNeural"},
    "ory": {"locale": "or-IN", "target": "or", "voice": "or-IN-SubhasiniNeural"},
    "asm": {"locale": "as-IN", "target": "as", "voice": "as-IN-YashicaNeural"},
    "npi": {"locale": "ne-NP", "target": "ne", "voice": "ne-NP-HemkalaNeural"},
    "arb": {"locale": "ar-SA", "target": "ar", "voice": "ar-SA-ZariyahNeural"},
    "cmn": {"locale": "zh-CN", "target": "zh-Hans", "voice": "zh-CN-XiaoxiaoNeural"},
    "fra": {"locale": "fr-FR", "target": "fr", "voice": "fr-FR-DeniseNeural"},
    "deu": {"locale": "de-DE", "target": "de", "voice": "de-DE-KatjaNeural"},
    "spa": {"locale": "es-ES", "target": "es", "voice": "es-ES-ElviraNeural"},
    "ita": {"locale": "it-IT", "target": "it", "voice": "it-IT-ElsaNeural"},
    "jpn": {"locale": "ja-JP", "target": "ja", "voice": "ja-JP-NanamiNeural"},
    "kor": {"locale": "ko-KR", "target": "ko", "voice": "ko-KR-SunHiNeural"},
    "rus": {"locale": "ru-RU", "target": "ru", "voice": "ru-RU-SvetlanaNeural"},
    "por": {"locale": "pt-BR", "target": "pt", "voice": "pt-BR-FranciscaNeural"},
}

#: Cap on queued output segments per stream. Azure can burst several
#: synthesis chunks at once; beyond this the student is too far behind
#: for the audio to still be worth playing and PlayoutBuffer would drop
#: it anyway.
_MAX_QUEUED = 256


def _to_int16_bytes(pcm: np.ndarray) -> bytes:
    """float32 [-1, 1] at 16 kHz -> the 16-bit PCM Azure's push stream wants."""
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    return (np.clip(samples, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()


def _from_int16_bytes(raw: bytes) -> np.ndarray:
    """Azure's Raw16Khz16BitMonoPcm synthesis output -> float32 [-1, 1]."""
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


@dataclass
class _AzureState:
    lang: str
    speech: bool
    recognizer: Any = None
    push_stream: Any = None
    #: Appended to by SDK callback threads, drained by push().
    pending: list = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    closed: bool = False
    #: Set by the `canceled` callback. Surfaced on the next push() so the
    #: stream is marked errored instead of silently going quiet — a class
    #: that believes it is being translated but is not is the failure
    #: mode this whole service is written to avoid.
    error: str | None = None

    def offer(self, item) -> None:  # noqa: ANN001
        with self.lock:
            if self.closed or len(self.pending) >= _MAX_QUEUED:
                return
            self.pending.append(item)

    def drain(self) -> list:
        with self.lock:
            out = self.pending
            self.pending = []
            return out


class AzureEngine:
    """Speech-to-speech translation through Azure Cognitive Services.

    Holds no model and no GPU: `load()` only verifies credentials and
    caches the voice list, so this engine runs on any machine, which is
    the reason it exists alongside the Seamless one.
    """

    def __init__(self) -> None:
        self._loaded = False
        # Same attribute surface the Seamless and stub engines expose,
        # because app.py's /health and its 503 guards are written against
        # it: `engine.loaded` (a property, not a call), `engine.load_error`
        # and `engine.device`.
        self.load_error: str | None = None
        self.device: str = "azure"
        self._speechsdk = None
        #: locale -> [voice name]. Populated at load() from Azure itself
        #: rather than hardcoded, so voices are never invented.
        self._voices: dict[str, list[str]] = {}

    # ---- lifecycle --------------------------------------------------

    def load(self) -> None:
        if self._loaded:
            return
        if not settings.azure_speech_key:
            self.load_error = "AZURE_SPEECH_KEY is not set"
            log.error("[Translation] %s — translation will report unavailable", self.load_error)
            return
        try:
            import azure.cognitiveservices.speech as speechsdk
        except ImportError as err:
            self.load_error = f"azure-cognitiveservices-speech is not installed ({err})"
            log.error("[Translation] %s", self.load_error)
            return

        self._speechsdk = speechsdk
        try:
            self._voices = self._fetch_voices()
        except Exception as err:  # noqa: BLE001 — a bad key must not crash the service
            # Deliberately not logging the exception object at error level
            # with the config attached: Azure's auth failures can echo
            # request headers, and the subscription key must never reach
            # a log file.
            self.load_error = f"Azure rejected the credentials or was unreachable: {type(err).__name__}"
            log.error("[Translation] voice list lookup failed: %s", type(err).__name__)
            return

        self._loaded = True
        self.load_error = None
        log.info(
            "[Translation] Azure engine ready (region=%s, %d locales with voices)",
            settings.azure_speech_region,
            len(self._voices),
        )

    def _fetch_voices(self) -> dict[str, list[str]]:
        """Asks Azure which voices actually exist in this region.

        Doing this once at startup is what lets AZURE_LANGS hold a mere
        *preference* per language: anything retired or renamed upstream
        is detected here instead of surfacing as a mid-class failure.
        """
        speechsdk = self._speechsdk
        cfg = speechsdk.SpeechConfig(
            subscription=settings.azure_speech_key,
            region=settings.azure_speech_region,
        )
        synth = speechsdk.SpeechSynthesizer(speech_config=cfg, audio_config=None)
        try:
            result = synth.get_voices_async().get()
            if result.reason != speechsdk.ResultReason.VoicesListRetrieved:
                raise RuntimeError(result.error_details or "voice list unavailable")
            by_locale: dict[str, list[str]] = {}
            for voice in result.voices:
                by_locale.setdefault(voice.locale, []).append(voice.short_name)
            return by_locale
        finally:
            # The synthesizer holds a connection; let it go rather than
            # keeping one open for the life of the process.
            del synth

    @property
    def loaded(self) -> bool:
        return self._loaded

    # ---- capability -------------------------------------------------

    def verify_languages(self, codes: list[str]) -> list[str]:
        """Returns the requested codes this engine cannot translate into."""
        return [c for c in codes if c not in AZURE_LANGS]

    def supports_speech(self, lang: str) -> bool:
        """Whether translated SPEECH (not just captions) is available.

        Unlike Seamless — which synthesises only 36 of its ~96 text
        targets — Azure has a neural voice for every language in
        AZURE_LANGS, so Tamil, Punjabi, Gujarati and the rest get real
        audio here rather than captions only. Still resolved against the
        live voice list, so a locale with no voice in this region
        degrades to captions instead of producing silence.
        """
        return self._resolve_voice(lang) is not None

    def _resolve_voice(self, lang: str) -> str | None:
        entry = AZURE_LANGS.get(lang)
        if not entry:
            return None
        locale = entry["locale"]
        available = self._voices.get(locale)
        if not available:
            # No voice list yet (load() not run, or offline): trust the
            # preferred name rather than claiming the language is
            # caption-only.
            return entry["voice"] if not self._voices else None
        if entry["voice"] in available:
            return entry["voice"]
        log.warning(
            "[Translation] preferred voice %s missing in %s; falling back to %s",
            entry["voice"],
            settings.azure_speech_region,
            available[0],
        )
        return available[0]

    # ---- per-stream state -------------------------------------------

    def build_state(self, tgt_lang: str, params: EngineParams, *, speech: bool):  # noqa: ANN201, ARG002
        if not self._loaded:
            raise ModelUnavailable(self.load_error or "Azure engine not loaded")
        entry = AZURE_LANGS.get(tgt_lang)
        if not entry:
            raise ModelUnavailable(f"{tgt_lang} is not in the Azure language table")

        speechsdk = self._speechsdk
        source = AZURE_LANGS.get(settings.azure_source_lang, AZURE_LANGS["eng"])

        cfg = speechsdk.translation.SpeechTranslationConfig(
            subscription=settings.azure_speech_key,
            region=settings.azure_speech_region,
        )
        cfg.speech_recognition_language = source["locale"]
        cfg.add_target_language(entry["target"])

        state = _AzureState(lang=tgt_lang, speech=speech)
        if speech:
            voice = self._resolve_voice(tgt_lang)
            if voice:
                cfg.voice_name = voice
                # Raw PCM at the service's own rate: no container to strip
                # and no resample before PlayoutBuffer.
                cfg.set_speech_synthesis_output_format(
                    speechsdk.SpeechSynthesisOutputFormat.Raw16Khz16BitMonoPcm
                )
            else:
                state.speech = False

        fmt = speechsdk.audio.AudioStreamFormat(
            samples_per_second=MODEL_SAMPLE_RATE, bits_per_sample=16, channels=1
        )
        state.push_stream = speechsdk.audio.PushAudioInputStream(fmt)
        recognizer = speechsdk.translation.TranslationRecognizer(
            translation_config=cfg,
            audio_config=speechsdk.audio.AudioConfig(stream=state.push_stream),
        )
        self._wire(recognizer, state, entry["target"])
        recognizer.start_continuous_recognition_async()
        state.recognizer = recognizer
        log.info(
            "[Translation] Azure stream started: %s -> %s (speech=%s)",
            source["locale"],
            entry["target"],
            state.speech,
        )
        return state

    def _wire(self, recognizer, state: _AzureState, target: str) -> None:  # noqa: ANN001
        """Connects the SDK's callbacks to this state's queue.

        Every callback is total: an exception thrown on an SDK thread
        would be swallowed by the SDK and the stream would go quiet with
        no way to tell, so each one is wrapped and reported as an error
        the stream can surface.
        """

        def on_recognizing(evt) -> None:  # noqa: ANN001
            try:
                text = evt.result.translations.get(target)
                if text:
                    state.offer(TextOut(content=text, finished=False))
            except Exception:  # noqa: BLE001
                log.exception("[Translation] recognizing handler failed")

        def on_recognized(evt) -> None:  # noqa: ANN001
            try:
                text = evt.result.translations.get(target)
                if text:
                    state.offer(TextOut(content=text, finished=True))
            except Exception:  # noqa: BLE001
                log.exception("[Translation] recognized handler failed")

        def on_synthesizing(evt) -> None:  # noqa: ANN001
            try:
                audio = evt.result.audio
                if audio:
                    state.offer(SpeechOut(content=_from_int16_bytes(audio)))
            except Exception:  # noqa: BLE001
                log.exception("[Translation] synthesizing handler failed")

        def on_canceled(evt) -> None:  # noqa: ANN001
            # Never log evt itself: cancellation details can echo request
            # metadata, and the subscription key must not reach the logs.
            detail = getattr(evt, "error_details", None) or getattr(evt, "reason", "cancelled")
            state.error = str(detail)
            log.error("[Translation] Azure cancelled %s: %s", state.lang, detail)

        def on_stopped(_evt) -> None:  # noqa: ANN001
            log.info("[Translation] Azure session stopped: %s", state.lang)

        recognizer.recognizing.connect(on_recognizing)
        recognizer.recognized.connect(on_recognized)
        recognizer.synthesizing.connect(on_synthesizing)
        recognizer.canceled.connect(on_canceled)
        recognizer.session_stopped.connect(on_stopped)

    def close_state(self, state) -> None:  # noqa: ANN001
        """Releases the recognizer and its WebSocket.

        Called when a language is dropped or a class ends. Without this
        an Azure session would stay open — and keep billing — for as long
        as the process lives.
        """
        if not isinstance(state, _AzureState) or state.closed:
            return
        state.closed = True
        try:
            if state.push_stream is not None:
                state.push_stream.close()
            if state.recognizer is not None:
                state.recognizer.stop_continuous_recognition_async().get()
        except Exception:  # noqa: BLE001 — teardown must never raise into the scheduler
            log.debug("[Translation] azure teardown for %s was not clean", state.lang, exc_info=True)
        finally:
            state.recognizer = None
            state.push_stream = None
            log.info("[Translation] Azure stream stopped: %s", state.lang)

    # ---- the hot path -----------------------------------------------

    def push(self, states, pcm_16k, *, is_final: bool):  # noqa: ANN001, ANN201
        if not self._loaded:
            raise ModelUnavailable(self.load_error or "Azure engine not loaded")
        state: _AzureState = states
        if state.error:
            raise ModelUnavailable(f"Azure stream failed: {state.error}")
        if state.closed:
            return []

        if not is_final:
            samples = np.asarray(pcm_16k, dtype=np.float32).reshape(-1)
            if samples.size and state.push_stream is not None:
                state.push_stream.write(_to_int16_bytes(samples))

        # Whatever Azure has produced since the last call. Results lag the
        # audio that caused them — that lag is the number the stream
        # reports to the teacher's console.
        return state.drain()

    # ---- reporting ---------------------------------------------------

    def vram(self) -> tuple[float | None, float | None]:
        # Nothing runs locally; the health endpoint shows no GPU usage.
        return (None, None)

    def device_name(self) -> str | None:
        return f"azure:{settings.azure_speech_region}"
