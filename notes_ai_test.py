"""Voice note title helpers (no network)."""

from __future__ import annotations

import notes_ai


def test_disabled_without_key(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_KEY", raising=False)
    assert notes_ai.is_enabled() is False
    assert notes_ai.title_from_transcript("hello there this is a test") is None
    assert notes_ai.status_payload()["enabled"] is False


def test_enabled_with_key(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    assert notes_ai.is_enabled() is True
    assert notes_ai.status_payload()["api_key_set"] is True


def test_placeholder_titles():
    assert notes_ai.is_placeholder_title("")
    assert notes_ai.is_placeholder_title("   ")
    assert notes_ai.is_placeholder_title("Note 2026-09-18 04:25")
    assert notes_ai.is_placeholder_title("Note 2026-09-18T04:25")
    assert notes_ai.is_placeholder_title("Note 2026-09-18")
    assert not notes_ai.is_placeholder_title("Mic check 1 2 3")
    assert not notes_ai.is_placeholder_title("VPS setup notes")


def test_sanitize_title():
    assert notes_ai.sanitize_title('  "Hello there."  ') == "Hello there"
    assert notes_ai.sanitize_title("Title: Weekly budget plan") == "Weekly budget plan"
    assert notes_ai.sanitize_title("one\ntwo") == "one"
    long = "word " * 40
    out = notes_ai.sanitize_title(long)
    assert len(out) <= notes_ai.MAX_TITLE_LEN
    assert out.endswith("…")


def test_parse_title_from_json_or_plain():
    assert notes_ai.parse_title_from_model('{"title": "Mic check"}') == "Mic check"
    assert notes_ai.parse_title_from_model("```json\n{\"title\": \"VPS kind\"}\n```") == "VPS kind"
    assert notes_ai.parse_title_from_model("GitHub plugin hover") == "GitHub plugin hover"


def test_clip_transcript_keeps_short():
    short = "hello " * 20
    assert notes_ai._clip_transcript(short) == short.strip()
    long = "a" * 8000
    clipped = notes_ai._clip_transcript(long)
    assert len(clipped) < len(long)
    assert "…" in clipped


def test_resolve_user_title_wins(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    monkeypatch.setattr(notes_ai, "title_from_transcript", lambda _t: "Should not run")
    title, source = notes_ai.resolve_title(
        user_title="My own title",
        transcript="hello this is a long enough transcript",
        created="2026-09-18T04:25:00+00:00",
    )
    assert title == "My own title"
    assert source == "user"


def test_resolve_keeps_legacy_custom_title(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    monkeypatch.setattr(notes_ai, "title_from_transcript", lambda _t: "Should not run")
    title, source = notes_ai.resolve_title(
        existing_title="Weekly budget plan",
        transcript="let's talk about the budget",
        created="2026-09-18T04:25:00+00:00",
    )
    assert title == "Weekly budget plan"
    assert source == "user"


def test_resolve_ai_when_placeholder(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    monkeypatch.setattr(notes_ai, "title_from_transcript", lambda _t: "Mic check")
    title, source = notes_ai.resolve_title(
        existing_title="Note 2026-09-18 04:25",
        existing_source="auto",
        transcript="hello hello mic check 1 2 3",
        created="2026-09-18T04:25:00+00:00",
    )
    assert title == "Mic check"
    assert source == "ai"


def test_resolve_auto_without_key(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_KEY", raising=False)
    title, source = notes_ai.resolve_title(
        transcript="hello hello mic check 1 2 3",
        created="2026-09-18T04:25:00+00:00",
    )
    assert title == "Note 2026-09-18 04:25"
    assert source == "auto"
