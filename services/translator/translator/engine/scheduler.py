"""
The single GPU worker.

Every stream's `step` runs on this one thread, round-robin over whichever
streams have a full source segment queued. One thread because the model's
weights are shared: running two steps concurrently contends inside CUDA
and makes both streams slower than taking turns would. Round-robin
(rather than draining one stream at a time) because a class with three
languages must not have one of them minutes behind the others.

Admission control lives here too — `max_streams` is the GPU's limit, not
a policy, so it is enforced at the thing being protected.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable

from ..config import settings
from .stream import TextDelta, TranslationStream

log = logging.getLogger(__name__)

#: How long the worker sleeps when no stream has work. Short enough that a
#: freshly-arrived segment is picked up well inside one frame interval.
IDLE_SLEEP_S = 0.005


class GpuScheduler:
    def __init__(self) -> None:
        self._streams: dict[tuple[str, str], TranslationStream] = {}
        self._sinks: dict[tuple[str, str], Callable[[list[TextDelta]], None]] = {}
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._rtf_window: list[tuple[float, float]] = []

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="gpu-scheduler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    # ---- stream registry -------------------------------------------------

    def at_capacity(self) -> bool:
        with self._lock:
            return len(self._streams) >= settings.max_streams

    def active_count(self) -> int:
        with self._lock:
            return len(self._streams)

    def add(
        self,
        session_id: str,
        stream: TranslationStream,
        on_text: Callable[[list[TextDelta]], None],
    ) -> None:
        key = (session_id, stream.lang)
        with self._lock:
            if len(self._streams) >= settings.max_streams and key not in self._streams:
                raise RuntimeError(
                    f"at capacity ({settings.max_streams} streams) — cannot add {stream.lang}"
                )
            self._streams[key] = stream
            self._sinks[key] = on_text
        log.info("stream added: %s/%s (%d active)", session_id, stream.lang, self.active_count())

    def remove(self, session_id: str, lang: str) -> None:
        key = (session_id, lang)
        with self._lock:
            stream = self._streams.pop(key, None)
            self._sinks.pop(key, None)
        # Outside the lock: closing an Azure stream waits on the SDK and
        # must not hold up every other language's step().
        if stream is not None:
            stream.close()
        log.info("stream removed: %s/%s (%d active)", session_id, lang, self.active_count())

    def remove_session(self, session_id: str) -> None:
        with self._lock:
            keys = [k for k in self._streams if k[0] == session_id]
            dropped = [self._streams.pop(k, None) for k in keys]
            for key in keys:
                self._sinks.pop(key, None)
        for stream in dropped:
            if stream is not None:
                stream.close()

    def get(self, session_id: str, lang: str) -> TranslationStream | None:
        with self._lock:
            return self._streams.get((session_id, lang))

    def session_streams(self, session_id: str) -> list[TranslationStream]:
        with self._lock:
            return [s for (sid, _lang), s in self._streams.items() if sid == session_id]

    # ---- the loop --------------------------------------------------------

    def _run(self) -> None:
        cursor = 0
        while not self._stop.is_set():
            with self._lock:
                keys = list(self._streams.keys())
            if not keys:
                time.sleep(IDLE_SLEEP_S)
                continue

            did_work = False
            # One pass over every stream per iteration, starting where the
            # last pass left off, so no stream can be starved by an
            # earlier one that always has audio ready.
            for offset in range(len(keys)):
                if self._stop.is_set():
                    break
                key = keys[(cursor + offset) % len(keys)]
                with self._lock:
                    stream = self._streams.get(key)
                    sink = self._sinks.get(key)
                if stream is None or sink is None or not stream.ready():
                    continue
                began = time.perf_counter()
                deltas = stream.step()
                elapsed = time.perf_counter() - began
                self._record_rtf(elapsed, stream.params.source_segment_size_ms / 1000)
                did_work = True
                if deltas:
                    try:
                        sink(deltas)
                    except Exception:  # noqa: BLE001 — a failing caption sink must not stop the GPU loop
                        log.exception("caption sink failed for %s/%s", key[0], key[1])
            cursor = (cursor + 1) % len(keys)
            if not did_work:
                time.sleep(IDLE_SLEEP_S)

    def _record_rtf(self, gpu_seconds: float, source_seconds: float) -> None:
        """Rolling real-time factor over the last ~30s of work."""
        now = time.monotonic()
        self._rtf_window.append((now, gpu_seconds / max(source_seconds, 1e-6)))
        cutoff = now - 30
        self._rtf_window = [(t, v) for t, v in self._rtf_window if t >= cutoff]

    def rtf(self) -> float | None:
        if not self._rtf_window:
            return None
        return sum(v for _t, v in self._rtf_window) / len(self._rtf_window)


scheduler = GpuScheduler()
