"""
A changed spoken language must reach streams that already exist.

The bug: the server's session upsert carried the new sourceLanguage, but
an existing session ignored it, so streams kept recognising in the OLD
language. Hindi heard by an English recogniser is transliterated, which
is why "English" listeners got romanised Hindi.
"""

from __future__ import annotations

import asyncio

from translator.engine.base import EngineParams
from translator.session import TranslationSession


def _session(source: str) -> tuple[TranslationSession, list[tuple[str, str, str]]]:
    """Must be called inside a running loop: livekit's Room() needs one."""
    s = TranslationSession(
        session_id="class-1",
        room_name="class:1:broadcast",
        livekit_url="ws://unused",
        token="unused",
        source_identity_prefix="st:teacher:",
        source_language=source,
        params=EngineParams(),
    )
    calls: list[tuple[str, str, str]] = []

    # Stand-ins for the LiveKit-publishing parts; they record the source
    # language each stream would have been built with.
    async def add_language(lang: str, params: EngineParams) -> None:  # noqa: ARG001
        calls.append(("add", lang, s.source_language))
        s.channels[lang] = object()  # type: ignore[assignment]

    async def remove_language(lang: str) -> None:
        calls.append(("remove", lang, s.source_language))
        s.channels.pop(lang, None)

    s.add_language = add_language  # type: ignore[method-assign]
    s.remove_language = remove_language  # type: ignore[method-assign]
    return s, calls


def test_spoken_language_change_rebuilds_streams_with_the_new_source():
    async def run() -> None:
        s, calls = _session("eng")
        await s.set_languages(["hin"], EngineParams())
        calls.clear()

        await s.set_source_language("hin", EngineParams())

        assert s.source_language == "hin"
        assert calls == [("remove", "hin", "hin"), ("add", "hin", "hin")]

    asyncio.run(run())


def test_unchanged_spoken_language_does_nothing():
    async def run() -> None:
        s, calls = _session("hin")
        await s.set_languages(["eng", "tam"], EngineParams())
        calls.clear()

        await s.set_source_language("hin", EngineParams())
        assert calls == []

    asyncio.run(run())


def test_languages_added_after_a_change_use_the_new_source():
    """The upsert applies the source before the targets, so a target added
    in the same request is never built against the stale language."""

    async def run() -> None:
        s, calls = _session("eng")
        await s.set_source_language("hin", EngineParams())
        await s.set_languages(["eng"], EngineParams())
        assert calls == [("add", "eng", "hin")]

    asyncio.run(run())
