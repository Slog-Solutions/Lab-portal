"""
Playout buffer for one translated audio channel.

The problem this solves: the model produces translated speech in bursts
(a whole clause at once, after it has heard enough to commit), but WebRTC
wants exactly one 20ms frame every 20ms, forever. Naively writing bursts
into the track leaves gaps, and — worse — any moment where the model
produces more than real-time audio adds permanent lag that accumulates
over a 45-minute lecture until the translation is a paragraph behind.

So this buffer:
  * always emits a frame, filling with silence when nothing is ready;
  * speeds playout up slightly (pitch preserved) when it falls behind;
  * skips ahead if the backlog becomes indefensible.

The result is bounded lag: a class that drifts recovers instead of
degrading for the rest of the lesson.
"""

from __future__ import annotations

import logging
import math
import threading

import numpy as np

from ..config import FRAME_MS, OUTPUT_SAMPLE_RATE

log = logging.getLogger(__name__)

FRAME_SAMPLES = OUTPUT_SAMPLE_RATE * FRAME_MS // 1000


class PlayoutBuffer:
    """Thread-safe: the GPU thread writes, the LiveKit publisher reads."""

    def __init__(self, *, catch_up_start_ms: int, max_catch_up_rate: float, drop_backlog_ms: int) -> None:
        self._buf = np.zeros(0, dtype=np.float32)
        self._lock = threading.Lock()
        self._catch_up_start_ms = catch_up_start_ms
        self._max_catch_up_rate = max_catch_up_rate
        self._drop_backlog_ms = drop_backlog_ms
        #: Set when the source goes quiet, so the tail is allowed to drain
        #: rather than being treated as backlog to catch up on.
        self._draining = False
        self.frames_emitted = 0
        self.silence_frames = 0
        self.dropped_ms = 0

    # ---- producer side ---------------------------------------------------

    def write(self, samples: np.ndarray) -> None:
        """Appends synthesised audio (float32, OUTPUT_SAMPLE_RATE, mono)."""
        with self._lock:
            self._buf = np.concatenate([self._buf, samples.astype(np.float32, copy=False)])
            self._draining = False

    def mark_drained(self) -> None:
        """The source has stopped; let whatever is buffered play out at 1x."""
        with self._lock:
            self._draining = True

    # ---- consumer side ---------------------------------------------------

    def backlog_ms(self) -> int:
        with self._lock:
            return int(len(self._buf) / OUTPUT_SAMPLE_RATE * 1000)

    def next_frame(self) -> np.ndarray:
        """Exactly one frame, always. Never blocks, never returns short."""
        with self._lock:
            backlog_ms = len(self._buf) / OUTPUT_SAMPLE_RATE * 1000

            # Indefensible backlog: skip ahead. Keeping it would mean the
            # student hears a translation of what the teacher said ten
            # seconds ago, which is worse than missing a clause — they are
            # watching the teacher's face and the board in real time.
            if backlog_ms > self._drop_backlog_ms and not self._draining:
                keep = int(self._catch_up_start_ms / 1000 * OUTPUT_SAMPLE_RATE)
                dropped = len(self._buf) - keep
                self._buf = self._buf[dropped:]
                self.dropped_ms += int(dropped / OUTPUT_SAMPLE_RATE * 1000)
                log.warning("playout dropped %dms to recover from a %dms backlog", int(dropped / OUTPUT_SAMPLE_RATE * 1000), int(backlog_ms))
                backlog_ms = len(self._buf) / OUTPUT_SAMPLE_RATE * 1000

            if len(self._buf) == 0:
                self.frames_emitted += 1
                self.silence_frames += 1
                return np.zeros(FRAME_SAMPLES, dtype=np.float32)

            # Mild speed-up while behind. Ramped with the backlog rather
            # than switched on at full rate, so the teacher's voice does
            # not audibly lurch between speeds mid-sentence.
            rate = 1.0
            if not self._draining and backlog_ms > self._catch_up_start_ms:
                over = backlog_ms - self._catch_up_start_ms
                span = max(1.0, self._drop_backlog_ms - self._catch_up_start_ms)
                rate = 1.0 + (self._max_catch_up_rate - 1.0) * min(1.0, over / span)

            needed = int(math.ceil(FRAME_SAMPLES * rate))
            take = min(needed, len(self._buf))
            chunk = self._buf[:take]
            self._buf = self._buf[take:]

        if rate == 1.0 and len(chunk) == FRAME_SAMPLES:
            frame = chunk
        else:
            # Resample the chunk down to one frame. Linear interpolation is
            # enough at these rates (<=1.15x over 20ms) and keeps pitch —
            # dropping samples instead would chirp audibly on every frame.
            if len(chunk) < 2:
                frame = np.zeros(FRAME_SAMPLES, dtype=np.float32)
            else:
                src_idx = np.linspace(0, len(chunk) - 1, FRAME_SAMPLES, dtype=np.float32)
                frame = np.interp(src_idx, np.arange(len(chunk), dtype=np.float32), chunk).astype(np.float32)

        if len(frame) < FRAME_SAMPLES:
            frame = np.pad(frame, (0, FRAME_SAMPLES - len(frame)))

        self.frames_emitted += 1
        return frame
