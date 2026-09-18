"""Prompt overrides (isolated TOOLKIT_DATA)."""

from __future__ import annotations

import pytest

import ai_usage
import notes_ai
from ai import catalog, fx, prompts
from ai.features import FINANCE_LEDGER, FOOD_MEAL_PROFILE, VOICE_NOTE_TITLE
from food import ai as food_ai


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("TOOLKIT_DATA", str(tmp_path))
    monkeypatch.setattr(ai_usage, "DATA_DIR", tmp_path / "ai")
    monkeypatch.setattr(ai_usage, "USAGE_PATH", tmp_path / "ai" / "usage.jsonl")
    monkeypatch.setattr(fx, "fetch_live", lambda: (_ for _ in ()).throw(OSError("offline")))
    return tmp_path


def test_default_is_code_prompt(data_dir):
    assert notes_ai.system_prompt() == notes_ai.SYSTEM
    assert food_ai.system_prompt() == food_ai.SYSTEM


def test_save_and_apply_system(data_dir):
    prompts.save_field(VOICE_NOTE_TITLE, field="system", text="ONLY the topic.")
    assert notes_ai.system_prompt() == "ONLY the topic."
    d = catalog.detail(VOICE_NOTE_TITLE)
    assert d["prompt"]["system"] == "ONLY the topic."
    assert d["prompt"]["system_overridden"] is True
    assert d["prompt"]["editable"] is True


def test_user_template_and_render(data_dir):
    prompts.save_field(
        VOICE_NOTE_TITLE,
        field="user_template",
        text="Title this:\n{transcript}\nEnd.",
    )
    out = notes_ai._user_prompt("hello {today} there")
    assert out.startswith("Title this:\n")
    assert "hello {today} there" in out
    assert out.endswith("End.")


def test_render_does_not_rewrite_values():
    out = prompts.render_template(
        "A {transcript} B {today}",
        {"transcript": "paid {today}", "today": "2026-09-18"},
    )
    assert out == "A paid {today} B 2026-09-18"


def test_reset_restores_default(data_dir):
    prompts.save_field(VOICE_NOTE_TITLE, field="system", text="custom")
    prompts.reset_field(VOICE_NOTE_TITLE, field="system")
    assert notes_ai.system_prompt() == notes_ai.SYSTEM
    assert prompts.get(VOICE_NOTE_TITLE)["system"] is None


def test_empty_save_is_reset(data_dir):
    prompts.save_field(VOICE_NOTE_TITLE, field="system", text="custom")
    prompts.save_field(VOICE_NOTE_TITLE, field="system", text="  ")
    assert notes_ai.system_prompt() == notes_ai.SYSTEM


def test_food_user_override(data_dir):
    prompts.save_field(
        FOOD_MEAL_PROFILE,
        field="user_template",
        text="Food={food}; bits={constitutes}; cat={catalog}",
    )
    out = food_ai.build_user_prompt(
        {"food": "poha", "constitutes": [{"name": "rice"}]},
        [],
    )
    assert out.startswith("Food=poha")
    assert "rice" in out


def test_finance_doc_override(data_dir):
    from finance import os_parse as finance_os

    prompts.save_field(
        FINANCE_LEDGER,
        field="doc",
        text="# custom parse task",
        name="PARSE_TASK.md",
    )
    sys = finance_os.os_ledger_system()
    assert "# custom parse task" in sys
    assert "You are a precise parser for a personal Indian Rupee ledger" in sys
    d = catalog.detail(FINANCE_LEDGER)
    doc = next(x for x in d["prompt"]["docs"] if x["name"] == "PARSE_TASK.md")
    assert doc["overridden"] is True
    assert doc["text"] == "# custom parse task"
    assert d["prompt"]["system_overridden"] is False


def test_cannot_edit_cloud_stt(data_dir):
    with pytest.raises(ValueError, match="not editable"):
        prompts.save_field("voice.cloud_stt", field="system", text="nope")


def test_unknown_id(data_dir):
    with pytest.raises(ValueError):
        prompts.save_field("cfa.readings", field="system", text="nope")
