# Live class translation (SeamlessStreaming)

Translates the teacher's voice into each student's chosen language, as
they speak. Students hear a dubbed voice and read live captions; the
teacher gets a per-language status readout and a test page.

This service is the GPU half. The control logic lives in the API
(`apps/server/src/modules/translation/`), the student selector in
`apps/web/src/features/student/TranslationBar.tsx`, and the teacher's
test page under `apps/web/src/features/translation/`.

---

## Before you start: the three things that decide whether this works

**1. You need an NVIDIA GPU with at least 12 GB of VRAM.**
SeamlessStreaming is 2.5B parameters — about 5 GB of weights in fp16,
plus activations, plus one agent state per concurrent language. A 4 GB
card (GTX 1650, 3050 laptop) cannot load it at all; the service will
start, report `modelLoaded: false` with the reason, and the app will
correctly show translation as unavailable rather than pretending.
Tested target: RTX 3060 12GB or better; L4/A10 for more than ~4 streams.

**CPU is not an option for live use.** Meta's own documentation says CPU
inference "will be slow and introduce noticeable delays". `cpu` exists
here only to smoke-test the HTTP surface.

**2. The model weights are CC-BY-NC-4.0 — non-commercial use only.**
This is Meta's license on the SeamlessStreaming checkpoints, not on this
code. It was accepted as a deliberate decision for this deployment. If
that ever changes, the engine is reached only through
`TranslatorClient` (`apps/server/.../translator.client.ts`), so a
differently-licensed engine behind the same HTTP contract would not touch
the app.

**3. Latency has a floor, and it is not a bug.**
Simultaneous translation has to hear enough words before it can commit to
any, because word order differs between languages. Expect:

| | behind the teacher |
|---|---|
| Captions | ~1.5–2.5 s |
| Translated speech | ~2.5–3.5 s |

Everything else in the path is kept near zero: WebRTC both ways (~100 ms
each), one GPU-resident model, continuous 20 ms framing, and active
catch-up so lag never accumulates across a lecture. If you are seeing 10
s, something is wrong — check RTF on the Test tab (below).

---

## What runs where

```
Teacher mic ──WebRTC──► LiveKit  class:<id>:broadcast ◄──WebRTC── Students
                           ▲   │ teacher mic @16k mono
          tr:hin, tr:ben … │   ▼
          + data "tr:captions"  this service (1 model in VRAM,
                           └──  1 stream per class × language)
                                      ▲ HTTP, x-api-key
            Nest TranslationModule ───┘  (reconciler: owns WHAT runs)
```

- **One stream per (class, language)** — not per student. 40 students
  across 3 languages is 3 streams.
- **The default costs nothing.** A student listening in the language the
  teacher is speaking gets the teacher's own audio, untouched. With
  default settings no GPU work happens at all.
- **Failure keeps the class running.** If this service is down, a stream
  fails, or a language is caption-only, students keep the teacher's
  original audio and see a short banner saying why. The class never goes
  silent.

---

## Setup

### 1. Host prerequisites

**Linux:** NVIDIA driver + [NVIDIA Container
Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
Verify:

```bash
docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi
```

**Windows:** Docker Desktop with the WSL2 backend and a current NVIDIA
driver on the host (do *not* install a driver inside WSL). Same verify
command.

If that command does not print your GPU, nothing below will work — fix it
first.

### 2. Build

```bash
docker compose --profile translation build translator
```

The image is large (~8 GB): CUDA runtime, torch, fairseq2 and
seamless_communication. The pinned versions in the Dockerfile are a
matched set — torch 2.1.1 / cu121 / fairseq2 0.2.1. Mismatching them is
the usual cause of `CUDA available: False` inside an otherwise healthy
container.

### 3. Fetch the weights (needs internet — do this off the lab server)

The lab server is air-gapped, so weights are vendored rather than
downloaded at runtime. The Seamless checkpoints are **gated** on Hugging
Face: accept the model terms on the
`facebook/seamless-streaming` page first, then:

```bash
mkdir -p ./models
docker run --rm \
  -e HF_TOKEN=hf_xxx \
  -v "$PWD/models:/models" \
  -v "$PWD/services/translator/scripts:/scripts:ro" \
  lab-portal/translator:latest \
  python /scripts/fetch_models.py --out /models
```

That fills `./models` with the streaming checkpoints, the monotonic
decoder, the vocoder, the tokenizers and Silero VAD — roughly 12 GB.
Copy it into the volume on the lab server:

```bash
docker volume create lab-portal-stack_translator-models
docker run --rm -v lab-portal-stack_translator-models:/dst -v "$PWD/models:/src:ro" \
  alpine sh -c 'cp -a /src/. /dst/'
```

`infra/offline/fetch-vendor.ps1` covers the same step for the Windows
offline bundle.

### 4. Configure and start

In the root `.env` (see `.env.docker.example`):

```ini
TRANSLATOR_URL=http://translator:8080
TRANSLATOR_API_KEY=<32+ random chars>
TRANSLATOR_DEVICE=cuda
TRANSLATOR_DTYPE=fp16
TRANSLATOR_MAX_STREAMS=4
```

```bash
docker compose --profile translation up -d
curl -s http://localhost:8080/health   # from inside the network
```

**Leave `TRANSLATOR_URL` empty on a server without a GPU.** Unset means
the whole feature hides itself — no student selector, no teacher toggle,
no nav item. That is a supported deployment, not a misconfiguration.

A healthy service reports:

```json
{ "gpu": true, "device": "NVIDIA RTX 3060", "modelLoaded": true,
  "vramUsedMb": 5400, "vramTotalMb": 12288, "activeStreams": 0, "maxStreams": 4 }
```

---

## Using it

**Teacher, per class:** Class Control → the broadcast panel's **Live
translation** row. Turn it on, confirm "I'm speaking" is right. Nothing
starts until a student actually picks a different language. The row then
shows each active language with its listener count and measured lag.

**Student:** a **Listen in** selector appears in the class panel,
defaulting to English, with live captions beneath it.

**Admin:** Speech Translation → Settings — which languages students may
choose, the stream ceiling, and the engine's latency knobs.

### Tuning, with the Test tab

Speech Translation → **Test**. Upload a clip, pick languages, leave mode
on **Real time**, and run it. Real-time mode paces the file at 1x through
a real LiveKit room and plays it back through the student listener
component, so the numbers mean something:

- **Caption lag p95** — target ≤ 2.5 s
- **Speech lag p95** — target ≤ 4 s
- **RTF** (GPU seconds per second of audio) — must be < 1.0, and
  comfortably below it with several streams. RTF ≥ 1 means the GPU cannot
  keep up and lag will grow until the playout buffer starts dropping.

Then change one knob in Settings, re-run the *same* clip, and compare.
Guessing at these without measuring is how a class ends up 10 s behind.

**Fast** mode skips the pacing and the room: same translation, as quick
as the GPU allows. Use it to judge wording, never latency.

---

## Languages

Seamless translates speech into ~96 languages as **text** but only 36 as
**speech**. The catalog in
`packages/shared/src/translation/languages.ts` carries a `speech` flag
per language, and the service checks it against the loaded checkpoint at
startup (a mismatch is logged).

Of the Indian languages: **Hindi, Bengali, Telugu and Urdu get translated
voice.** Tamil, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia,
Assamese and Nepali are **captions-only** — the student keeps the
teacher's audio and reads along. The student's selector says which is
which, so nobody is left wondering why they can't hear a translation.

Caption-only streams run the `s2tt` task instead of `s2st`: no unit
decoder, no vocoder, roughly half the GPU work. They are the cheap option
when capacity is tight.

---

## Troubleshooting

**`/health` says `modelLoaded: false`**
Read its `detail`. Usually: weights not in the volume (step 3), the GPU
is too small (`CUDA out of memory`), or the gated HF download silently
produced nothing.

**`CUDA requested but unavailable`**
The container cannot see the GPU. Re-run the `nvidia-smi` check in step 1;
on Windows confirm Docker Desktop is on the WSL2 backend.

**Teacher hears the translation echoing / translation goes garbled**
The teacher is monitoring on speakers. Their own mic picks the
translation up and feeds it back into the translator, which then
translates its own output. Use headphones — the UI warns about this
whenever a monitor language is selected. (Students cannot cause this:
their consoles never publish into the class room unmuted while listening
to a translation.)

**Students hear two voices at once**
A student console subscribed to both the teacher's mic and a translation.
The subscription filter in `apps/web/src/lib/livekit-client.ts` plus
`shouldMuteOriginal` in `TranslationBar.tsx` are what prevent this; check
the browser console for a filter that rejected nothing.

**Lag grows steadily through a lecture**
RTF is at or above 1.0 — too many streams for the GPU. Lower
`maxStreams` in Settings, or enable fewer languages. The playout buffer
bounds the damage (it speeds up, then skips) but cannot create GPU
capacity.

**A language never starts**
Check it is enabled in Settings, that it is not the class's spoken
language, and that `activeStreams` is below `maxStreams`. The teacher's
status row names the reason.

---

## Running on a dev box without a GPU (stub mode)

The real engine **cannot be installed on Windows at all** — not merely
slowly. `fairseq2n`, the native half of fairseq2, publishes no Windows
distribution, so SeamlessStreaming needs Linux (Docker/WSL2) regardless
of what GPU is present.

So for developing and demoing everything *around* the model there is a
stub engine. It needs no torch, no fairseq2, no CUDA and no weights, and
it exercises the entire real pipeline: token minting, room join,
source-track binding, the GPU scheduler, the playout buffer, per-language
track publishing, the subscription filters, caption delivery over the data
channel, language switching, the teacher's status row and the whole
Translation Lab path.

Instead of translating, it:
- emits real caption segments (placeholder text that says it is a stub) on
  the real data channel, numbered and lag-stamped, so segment replacement
  and the caption UI are genuinely driven;
- returns the teacher's own audio ring-modulated at a frequency derived
  from the target language — same duration (so playout timing stays real),
  unmistakably robotic, and **different per language**, which is how you
  confirm by ear that picking Hindi versus Bengali really does switch
  which track you are subscribed to.

```bash
cd services/translator
python -m pip install -r requirements-stub.txt
TRANSLATOR_ENGINE=stub TRANSLATOR_API_KEY=dev-key-at-least-32-characters-long \
  python -m uvicorn translator.app:app --host 127.0.0.1 --port 8080
```

PowerShell:

```powershell
cd services\translator
python -m pip install -r requirements-stub.txt
$env:TRANSLATOR_ENGINE = "stub"
$env:TRANSLATOR_API_KEY = "dev-key-at-least-32-characters-long"
python -m uvicorn translator.app:app --host 127.0.0.1 --port 8080
```

Then in `apps/server/.env`:

```ini
TRANSLATOR_URL=http://127.0.0.1:8080
TRANSLATOR_API_KEY=dev-key-at-least-32-characters-long
```

`/health` reports `engine: "stub"`, `gpu: false` and a `detail` saying so
— which the teacher's console surfaces as a "running without a GPU"
warning. That warning is correct and should stay visible: an RTF or a lag
figure from this engine means nothing about the real model.

**Port gotchas on a Windows dev box.** Two ports commonly collide:

- **8080** is often taken (Steam's web helper, among others). Any free
  port works — just match `TRANSLATOR_URL`.
- **7881** (LiveKit's TCP fallback) gets held by Docker Desktop's
  `wslrelay` whenever the compose stack has ever mapped it, which makes
  `node scripts/livekit.mjs` fail with "Only one usage of each socket
  address". Either quit Docker Desktop, or run the LiveKit binary against
  a copy of `infra/livekit/livekit.yaml` with `rtc.tcp_port` moved to a
  free port (TCP is only an ICE fallback; signalling on 7880 and UDP
  7882-7892 are what matter locally). While you are there, note that the
  committed config pins `node_ip: 192.168.1.22` for LAN testing — set it
  to `127.0.0.1` for single-machine work.

The server picks `TRANSLATOR_URL` up at boot, so after editing `.env`
restart the API (a plain file-touch will not do it — `nest start --watch`
only restarts on a real source change).

## Development

The playout buffer is pure numpy and tested without a GPU:

```bash
cd services/translator
python -m pip install numpy pytest
python -m pytest tests/ -q
```

The server-side reconciler is tested against a stand-in translator over
real HTTP — no GPU, no LiveKit:

```bash
cd apps/server && npx vitest run src/modules/translation
```

`TRANSLATOR_DISABLE_MODEL=1` boots the service with its HTTP surface but
no model, for exercising the API on a machine that cannot load it.
