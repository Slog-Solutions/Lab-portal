"""Playout buffer behaviour. Pure numpy — no model, no GPU, no LiveKit."""

from __future__ import annotations

import numpy as np
import pytest

from translator.config import OUTPUT_SAMPLE_RATE
from translator.engine.playout import FRAME_SAMPLES, PlayoutBuffer


def make(**kw) -> PlayoutBuffer:
    return PlayoutBuffer(
        catch_up_start_ms=kw.get("catch_up_start_ms", 1500),
        max_catch_up_rate=kw.get("max_catch_up_rate", 1.15),
        drop_backlog_ms=kw.get("drop_backlog_ms", 5000),
    )


def seconds(n: float) -> np.ndarray:
    return np.ones(int(OUTPUT_SAMPLE_RATE * n), dtype=np.float32) * 0.5


def test_empty_buffer_emits_silence_not_a_short_frame():
    # WebRTC needs a frame every tick whether or not the model has
    # produced anything; a short or absent frame is a glitch.
    buf = make()
    frame = buf.next_frame()
    assert len(frame) == FRAME_SAMPLES
    assert np.all(frame == 0)
    assert buf.silence_frames == 1


def test_every_frame_is_exactly_one_frame_long():
    buf = make()
    buf.write(seconds(0.05))  # not a whole number of frames
    for _ in range(10):
        assert len(buf.next_frame()) == FRAME_SAMPLES


def test_plays_at_1x_when_backlog_is_small():
    buf = make()
    buf.write(seconds(0.2))
    before = buf.backlog_ms()
    buf.next_frame()
    # One 20ms frame consumed exactly 20ms of audio.
    assert before - buf.backlog_ms() == pytest.approx(20, abs=2)


def test_speeds_up_once_past_the_catch_up_threshold():
    buf = make(catch_up_start_ms=500, max_catch_up_rate=1.15, drop_backlog_ms=5000)
    buf.write(seconds(4.0))  # well past 500ms, so near max rate
    before = buf.backlog_ms()
    buf.next_frame()
    consumed = before - buf.backlog_ms()
    # Faster than real time, but bounded by max_catch_up_rate.
    assert consumed > 20
    assert consumed <= 20 * 1.15 + 2


def test_catch_up_is_ramped_not_switched():
    # Just over the threshold should be barely faster than 1x; deep
    # backlog should be near the cap. A step change would be audible as a
    # lurch mid-sentence.
    shallow = make(catch_up_start_ms=500, max_catch_up_rate=1.15, drop_backlog_ms=5000)
    shallow.write(seconds(0.56))
    deep = make(catch_up_start_ms=500, max_catch_up_rate=1.15, drop_backlog_ms=5000)
    deep.write(seconds(4.5))

    def consumed(b: PlayoutBuffer) -> float:
        before = b.backlog_ms()
        b.next_frame()
        return before - b.backlog_ms()

    assert consumed(shallow) < consumed(deep)


def test_drops_to_recover_from_an_indefensible_backlog():
    buf = make(catch_up_start_ms=1500, max_catch_up_rate=1.15, drop_backlog_ms=3000)
    buf.write(seconds(10.0))
    buf.next_frame()
    # Recovered to roughly the catch-up threshold, not left 10s behind.
    assert buf.backlog_ms() <= 1600
    assert buf.dropped_ms > 0


def test_draining_plays_the_tail_at_1x_without_dropping():
    # When the teacher stops talking, whatever is buffered is the END of
    # a sentence — rushing or dropping it would cut the student off
    # mid-clause for no latency benefit.
    buf = make(catch_up_start_ms=200, max_catch_up_rate=1.15, drop_backlog_ms=500)
    buf.write(seconds(2.0))
    buf.mark_drained()
    before = buf.backlog_ms()
    buf.next_frame()
    assert before - buf.backlog_ms() == pytest.approx(20, abs=2)
    assert buf.dropped_ms == 0


def test_write_after_draining_resumes_catch_up():
    buf = make(catch_up_start_ms=200, max_catch_up_rate=1.15, drop_backlog_ms=10_000)
    buf.write(seconds(1.0))
    buf.mark_drained()
    buf.write(seconds(1.0))  # teacher started talking again
    before = buf.backlog_ms()
    buf.next_frame()
    assert before - buf.backlog_ms() > 20


def test_preserves_signal_rather_than_decimating():
    # Catch-up resamples, so a constant tone stays a constant tone
    # instead of picking up frame-rate chirp from dropped samples.
    buf = make(catch_up_start_ms=100, max_catch_up_rate=1.15, drop_backlog_ms=5000)
    buf.write(seconds(2.0))
    frame = buf.next_frame()
    assert np.allclose(frame, 0.5, atol=1e-5)
