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

import dataclasses
import logging
import threading
import time
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

#: Azure's own floor for Speech_SegmentationMaximumTimeMs (SDK range
#: 20000-70000). It cannot force short phrases; it only stops a teacher who
#: never pauses from delaying translated audio indefinitely.
_MAX_PHRASE_MS = 20000

#: Playout limits for an engine that delivers a whole phrase of speech at
#: once. The shared defaults are tuned for Seamless, which trickles audio
#: continuously: its 5s drop threshold discarded everything but the last
#: 1.5s of any longer Azure phrase, so students heard only sentence
#: endings. A drop must never fire on a single phrase (up to
#: _MAX_PHRASE_MS), and catch-up stays mild because it resamples, which
#: shifts the voice's pitch.
_PLAYOUT_CATCH_UP_START_MS = 8000
_PLAYOUT_DROP_BACKLOG_MS = _MAX_PHRASE_MS + 10000
_PLAYOUT_MAX_CATCH_UP_RATE = 1.08

#: Azure ends a phrase only when it RECEIVES silence. WebRTC sends no audio
#: at all while the teacher pauses, so without help the last sentence before
#: every pause waited until they spoke again. After this long with no input
#: the engine feeds silence itself. Comfortably above the 320ms gap between
#: real source segments, so it never splices silence into speech.
_SILENCE_FEED_AFTER_S = 0.6
#: Total silence fed per pause: enough to pass the segmentation timeout with
#: margin, and capped because Azure bills for every second of audio sent.
_SILENCE_FEED_MAX_S = 2.0

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
    #: Set once the source has ended (end of a test-run file) and the push
    #: stream was closed, which tells Azure to finish the last phrase.
    input_closed: bool = False
    #: Azure has emitted everything it will for this session.
    stopped: threading.Event = field(default_factory=threading.Event)
    #: monotonic() of the last write to Azure (real audio or fed silence).
    last_write: float = field(default_factory=time.monotonic)
    #: Silence fed since the last real audio — see _SILENCE_FEED_MAX_S.
    silence_fed_s: float = 0.0

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

    def tune_params(self, params: EngineParams) -> EngineParams:
        """Playout limits suited to phrase-at-a-time speech; see _PLAYOUT_*."""
        return dataclasses.replace(
            params,
            catch_up_start_ms=_PLAYOUT_CATCH_UP_START_MS,
            drop_backlog_ms=_PLAYOUT_DROP_BACKLOG_MS,
            max_catch_up_rate=_PLAYOUT_MAX_CATCH_UP_RATE,
        )

    def build_state(self, tgt_lang: str, params: EngineParams, *, speech: bool, source_lang: str = ""):  # noqa: ANN201, ARG002
        if not self._loaded:
            raise ModelUnavailable(self.load_error or "Azure engine not loaded")
        entry = AZURE_LANGS.get(tgt_lang)
        if not entry:
            raise ModelUnavailable(f"{tgt_lang} is not in the Azure language table")

        speechsdk = self._speechsdk
        # Per-session, set by the teacher for this class. AZURE_SOURCE_LANG
        # is only the fallback for a caller that does not say.
        spoken = source_lang or settings.azure_source_lang
        source = AZURE_LANGS.get(spoken)
        if not source:
            raise ModelUnavailable(f"spoken language {spoken!r} is not in the Azure language table")

        cfg = speechsdk.translation.SpeechTranslationConfig(
            subscription=settings.azure_speech_key,
            region=settings.azure_speech_region,
        )
        cfg.speech_recognition_language = source["locale"]
        cfg.add_target_language(entry["target"])
        # Azure speaks a phrase's translation only when the phrase ends, so
        # how soon a phrase ends IS the audio latency. Time-based
        # segmentation makes the silence timeout and the maximum phrase
        # length below take effect.
        props = speechsdk.PropertyId
        cfg.set_property(props.Speech_SegmentationStrategy, "Time")
        cfg.set_property(props.Speech_SegmentationSilenceTimeoutMs, str(settings.azure_segmentation_silence_ms))
        cfg.set_property(props.Speech_SegmentationMaximumTimeMs, str(_MAX_PHRASE_MS))
        # Partial translations get rewritten as more words arrive; this
        # holds back the unstable tail so live captions stop flickering.
        cfg.set_property(props.SpeechServiceResponse_TranslationRequestStablePartialResult, "true")

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
                    state.offer(TextOut(content=text, finished=False, replace=True))
            except Exception:  # noqa: BLE001
                log.exception("[Translation] recognizing handler failed")

        def on_recognized(evt) -> None:  # noqa: ANN001
            try:
                text = evt.result.translations.get(target)
                if text:
                    state.offer(TextOut(content=text, finished=True, replace=True))
            except Exception:  # noqa: BLE001
                log.exception("[Translation] recognized handler failed")

        def on_synthesizing(evt) -> None:  # noqa: ANN001
            try:
                audio = evt.result.audio
                if audio:
                    state.offer(SpeechOut(content=_from_int16_bytes(audio)))
            except Exception:  # noqa: BLE001
                log.exception("[Translation] synthesizing handler failed")

        end_of_stream = self._speechsdk.CancellationReason.EndOfStream

        def on_canceled(evt) -> None:  # noqa: ANN001
            # EndOfStream is how Azure reports a normal finish once the
            # input is closed — not a failure. Treating it as one marked
            # every completed test run as failed.
            if getattr(evt, "reason", None) == end_of_stream:
                state.stopped.set()
                return
            # Never log evt itself: cancellation details can echo request
            # metadata, and the subscription key must not reach the logs.
            detail = getattr(evt, "error_details", None) or getattr(evt, "reason", "cancelled")
            state.error = str(detail)
            state.stopped.set()
            log.error("[Translation] Azure cancelled %s: %s", state.lang, detail)

        def on_stopped(_evt) -> None:  # noqa: ANN001
            state.stopped.set()
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
                state.last_write = time.monotonic()
                state.silence_fed_s = 0.0
        elif not state.input_closed and state.push_stream is not None:
            # The source ended (only a test run signals this; a live class
            # never does). Closing the input makes Azure finish the last
            # phrase instead of waiting for silence that will never come.
            state.push_stream.close()
            state.input_closed = True

        # Whatever Azure has produced since the last call. Results lag the
        # audio that caused them — that lag is the number the stream
        # reports to the teacher's console.
        return state.drain()

    def idle(self, states) -> bool:  # noqa: ANN001
        """Nothing more will arrive: Azure finished after the input closed
        and every result has been collected. A live stream (input never
        closed) has nothing to flush, so it counts as idle."""
        state: _AzureState = states
        if state.closed or not state.input_closed:
            return True
        with state.lock:
            pending = bool(state.pending)
        return state.stopped.is_set() and not pending

    def poll(self, states):  # noqa: ANN001, ANN201
        """Results that arrived with no new input — see TranslationStream.poll.

        Cheap: a lock and a list swap, so the scheduler can call it on
        every idle pass.
        """
        state: _AzureState = states
        if state.error:
            raise ModelUnavailable(f"Azure stream failed: {state.error}")
        if state.closed:
            return []
        self._feed_pause_silence(state)
        return state.drain()

    def _feed_pause_silence(self, state: _AzureState) -> None:
        """Lets Azure finish the phrase in progress when input has stopped."""
        if state.input_closed or state.push_stream is None:
            return
        now = time.monotonic()
        gap = now - state.last_write
        if gap < _SILENCE_FEED_AFTER_S or state.silence_fed_s >= _SILENCE_FEED_MAX_S:
            return
        seconds = min(gap, _SILENCE_FEED_MAX_S - state.silence_fed_s)
        state.push_stream.write(bytes(int(seconds * MODEL_SAMPLE_RATE) * 2))  # 16-bit zeros
        state.silence_fed_s += seconds
        state.last_write = now

    # ---- reporting ---------------------------------------------------

    def vram(self) -> tuple[float | None, float | None]:
        # Nothing runs locally; the health endpoint shows no GPU usage.
        return (None, None)

    def device_name(self) -> str | None:
        return f"azure:{settings.azure_speech_region}"
