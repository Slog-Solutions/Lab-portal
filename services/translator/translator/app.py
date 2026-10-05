"""
HTTP control surface for the translator.

The Nest server is the only client. It owns WHAT should be running
(TranslationService's reconciler) and this service owns HOW — so every
endpoint here is idempotent and stateless towards the caller: `PUT
/v1/sessions/{id}` with a language list converges on it, and a translator
restart is recovered by the server's next sweep rather than by anything
persisted here.
"""

from __future__ import annotations

import logging
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config import settings
from .engine.model import EngineParams, engine
from .engine.scheduler import scheduler
from .session import TranslationSession
from . import testrun

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Lab Portal translator", version="1.0")

_sessions: dict[str, TranslationSession] = {}


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Shared-secret gate on every control call.

    Fails CLOSED when no key is configured, rather than running open:
    these endpoints hand the service a LiveKit token and a filesystem
    path, so an unauthenticated one would let anything else on the host
    join a class's audio. /health stays open so the server can report
    *why* translation is unavailable.
    """
    if not settings.api_key:
        raise HTTPException(status_code=503, detail="TRANSLATOR_API_KEY is not set — refusing unauthenticated control calls")
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="bad api key")


class EngineParamsPayload(BaseModel):
    sourceSegmentSizeMs: int = 320
    decisionThreshold: float = 0.5
    minStartingWaitMs: int = 576
    catchUpStartMs: int = 1500
    maxCatchUpRate: float = 1.15
    dropBacklogMs: int = 5000


class UpsertSessionPayload(BaseModel):
    sessionId: str
    room: str
    livekitUrl: str
    token: str
    sourceIdentityPrefix: str
    sourceLanguage: str = "eng"
    targetLanguages: list[str] = Field(default_factory=list)
    engineParams: EngineParamsPayload = Field(default_factory=EngineParamsPayload)


class TestRunPayload(BaseModel):
    runId: str
    audioPath: str | None = None
    audioUrl: str | None = None
    sourceLanguage: str = "eng"
    targetLanguages: list[str]
    mode: str = "realtime"
    engineParams: EngineParamsPayload = Field(default_factory=EngineParamsPayload)
    outputDir: str
    room: str | None = None
    livekitUrl: str | None = None
    token: str | None = None


@app.on_event("startup")
async def on_startup() -> None:
    # TORCH_HOME points at the vendored model dir so torch.hub (Silero
    # VAD) resolves offline — the lab server has no internet.
    os.environ.setdefault("TORCH_HOME", settings.model_dir)
    engine.load()
    scheduler.start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    for session in list(_sessions.values()):
        await session.close()
    _sessions.clear()
    scheduler.stop()


@app.get("/health")
async def health() -> dict:
    used_mb, total_mb = engine.vram()
    is_stub = settings.engine == "stub"
    # `gpu: false` for the stub on purpose: the teacher's console shows a
    # "running without a GPU" warning on that, which is exactly the
    # caveat that should be visible while a stub is answering.
    detail = engine.load_error
    if is_stub and not detail:
        detail = "Stub engine: captions are placeholder text and translated audio is the teacher's own voice, modulated per language. Pipeline testing only."
    return {
        "gpu": (not is_stub) and engine.device.startswith("cuda") and engine.loaded,
        "device": engine.device_name() or engine.device,
        "modelLoaded": engine.loaded,
        "engine": settings.engine,
        "vramUsedMb": used_mb,
        "vramTotalMb": total_mb,
        "activeStreams": scheduler.active_count(),
        "maxStreams": settings.max_streams,
        "rtf": scheduler.rtf(),
        **({"detail": detail} if detail else {}),
    }


@app.get("/v1/sessions", dependencies=[Depends(require_api_key)])
async def list_sessions() -> dict:
    return {"sessions": [s.stats_payload() for s in _sessions.values()]}


@app.put("/v1/sessions/{session_id}", dependencies=[Depends(require_api_key)])
async def upsert_session(session_id: str, payload: UpsertSessionPayload) -> dict:
    if not engine.loaded:
        raise HTTPException(status_code=503, detail=engine.load_error or "model not loaded")
    params = EngineParams.from_payload(payload.engineParams.model_dump())

    session = _sessions.get(session_id)
    if session is None:
        session = TranslationSession(
            session_id=session_id,
            room_name=payload.room,
            livekit_url=payload.livekitUrl,
            token=payload.token,
            source_identity_prefix=payload.sourceIdentityPrefix,
            source_language=payload.sourceLanguage,
            params=params,
        )
        try:
            await session.connect()
        except Exception as err:  # noqa: BLE001
            log.exception("could not connect session %s to %s", session_id, payload.room)
            raise HTTPException(status_code=502, detail=f"LiveKit connect failed: {err}") from err
        _sessions[session_id] = session

    try:
        # Before targets: a language that is both newly added and affected
        # by a spoken-language change must be built against the new source.
        await session.set_source_language(payload.sourceLanguage, params)
        await session.set_languages(payload.targetLanguages, params)
    except RuntimeError as err:
        # At capacity: report it rather than silently running fewer
        # languages than asked for, so the teacher's console can say so.
        raise HTTPException(status_code=429, detail=str(err)) from err
    return session.stats_payload()


@app.delete("/v1/sessions/{session_id}", dependencies=[Depends(require_api_key)])
async def delete_session(session_id: str) -> dict:
    session = _sessions.pop(session_id, None)
    if session is not None:
        await session.close()
    # 200 either way: "gone" is the desired end state, and class teardown
    # must not fail because the session was already cleaned up.
    return {"ok": True}


@app.post("/v1/test-runs", dependencies=[Depends(require_api_key)])
async def create_test_run(payload: TestRunPayload) -> dict:
    if not engine.loaded:
        raise HTTPException(status_code=503, detail=engine.load_error or "model not loaded")
    if not payload.audioPath:
        raise HTTPException(status_code=400, detail="audioPath is required (audioUrl is not implemented)")
    if not os.path.isfile(payload.audioPath):
        # Almost always a TRANSLATOR_DATA_ROOT mismatch, so say which path
        # was tried rather than a bare ENOENT.
        raise HTTPException(status_code=400, detail=f"audio not found at {payload.audioPath} (check TRANSLATOR_DATA_ROOT)")
    run = await testrun.start_test_run(
        run_id=payload.runId,
        audio_path=payload.audioPath,
        source_language=payload.sourceLanguage,
        target_languages=payload.targetLanguages,
        mode=payload.mode,
        params=EngineParams.from_payload(payload.engineParams.model_dump()),
        output_dir=payload.outputDir,
        room=payload.room,
        livekit_url=payload.livekitUrl,
        token=payload.token,
    )
    return {"runId": run.run_id, "status": run.status}


@app.get("/v1/test-runs/{run_id}", dependencies=[Depends(require_api_key)])
async def get_test_run(run_id: str) -> dict:
    run = testrun.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown run")
    return {
        "runId": run.run_id,
        "status": run.status,
        **({"error": run.error} if run.error else {}),
        **({"durationMs": run.duration_ms} if run.duration_ms is not None else {}),
        **({"metrics": run.metrics} if run.metrics else {}),
    }


@app.delete("/v1/test-runs/{run_id}", dependencies=[Depends(require_api_key)])
async def delete_test_run(run_id: str) -> dict:
    await testrun.cancel_test_run(run_id)
    return {"ok": True}
