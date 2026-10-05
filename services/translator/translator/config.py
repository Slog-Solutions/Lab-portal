"""Service configuration, from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass

#: The model's native sample rate. Every path in this service resamples to
#: this before touching the engine; WebRTC itself runs at 48k.
MODEL_SAMPLE_RATE = 16_000

#: What we publish to LiveKit. 48k is WebRTC's native rate, so publishing
#: at it avoids a second resample inside libwebrtc.
OUTPUT_SAMPLE_RATE = 48_000

#: LiveKit audio frame size. 20ms is the WebRTC standard frame; the
#: playout buffer emits exactly one of these per tick, always.
FRAME_MS = 20


@dataclass(frozen=True)
class Settings:
    api_key: str | None
    host: str
    port: int
    device: str
    dtype: str
    #: Hard ceiling on concurrent (session, language) streams, independent
    #: of what the Nest server asks for — the GPU is the thing being
    #: protected, and it is shared across every class.
    max_streams: int
    #: Where fetch_models.py put the checkpoints. Also used as TORCH_HOME
    #: so Silero VAD loads offline.
    model_dir: str
    #: Skip loading the model entirely (CI, or a dev box whose GPU cannot
    #: fit 2.5B params). /health reports model_loaded=false and every
    #: translate call fails loudly rather than silently returning silence.
    disable_model: bool
    #: 'seamless' (the real model) or 'stub'. The stub needs no torch, no
    #: fairseq2 and no GPU, and exists so the rest of the pipeline can be
    #: tested on a machine that cannot run the model — including any
    #: Windows box, since fairseq2n has no Windows distribution at all.
    #: It does NOT translate; see engine/stub.py.
    engine: str
    #: Azure Speech credentials, used only by engine='azure'. The key is
    #: read here and never leaves the service: it is not returned by
    #: /health, not logged, and never sent to the Nest server or any
    #: browser.
    azure_speech_key: str | None
    azure_speech_region: str
    #: The language the teacher speaks, as an ISO-639-3 code from
    #: AZURE_LANGS. Azure needs the source locale up front; the server
    #: already knows the class's spoken language, so this is the default
    #: for when it does not say.
    azure_source_lang: str
    #: Silence (ms) that ends a phrase. Azure speaks each phrase's
    #: translation only once the phrase ends, so this is the main latency
    #: knob: lower = translated audio sooner, but too low cuts sentences
    #: mid-thought and hurts accuracy. SDK range 100-5000.
    azure_segmentation_silence_ms: int

    @staticmethod
    def from_env() -> "Settings":
        return Settings(
            api_key=os.environ.get("TRANSLATOR_API_KEY") or None,
            host=os.environ.get("TRANSLATOR_HOST", "0.0.0.0"),
            port=int(os.environ.get("TRANSLATOR_PORT", "8080")),
            device=os.environ.get("TRANSLATOR_DEVICE", "cuda"),
            # fp16 halves the 2.5B model's VRAM and is what makes it fit on
            # a 12GB card alongside its activations.
            dtype=os.environ.get("TRANSLATOR_DTYPE", "fp16"),
            max_streams=int(os.environ.get("TRANSLATOR_MAX_STREAMS", "4")),
            model_dir=os.environ.get("TRANSLATOR_MODEL_DIR", "/models"),
            disable_model=os.environ.get("TRANSLATOR_DISABLE_MODEL", "").lower() in {"1", "true", "yes"},
            engine=os.environ.get("TRANSLATOR_ENGINE", "seamless").strip().lower(),
            azure_speech_key=os.environ.get("AZURE_SPEECH_KEY") or None,
            azure_speech_region=os.environ.get("AZURE_SPEECH_REGION", "centralindia").strip(),
            azure_source_lang=os.environ.get("AZURE_SOURCE_LANG", "eng").strip().lower(),
            azure_segmentation_silence_ms=min(5000, max(100, int(os.environ.get("AZURE_SEGMENTATION_SILENCE_MS", "400")))),
        )


settings = Settings.from_env()
