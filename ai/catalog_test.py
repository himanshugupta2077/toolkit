"""AI catalog + overview (no network, isolated data dir)."""

from __future__ import annotations

import json

import pytest

import ai_usage
from ai import catalog, features, fx
from ai.features import (
    FINANCE_LEDGER,
    FINANCE_RECEIPT,
    FOOD_MEAL_PROFILE,
    TOGGLEABLE_IDS,
    VOICE_CLOUD_STT,
    VOICE_NOTE_TITLE,
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("TOOLKIT_DATA", str(tmp_path))
    monkeypatch.setattr(ai_usage, "DATA_DIR", tmp_path / "ai")
    monkeypatch.setattr(ai_usage, "USAGE_PATH", tmp_path / "ai" / "usage.jsonl")
    monkeypatch.setattr(fx, "fetch_live", lambda: (_ for _ in ()).throw(OSError("offline")))
    features.set_usd_inr_override(88.0)
    return tmp_path


def test_use_case_ids_unique():
    ids = [u["id"] for u in catalog.use_cases()]
    assert len(ids) == len(set(ids))
    assert TOGGLEABLE_IDS <= set(ids)
    assert {VOICE_NOTE_TITLE, VOICE_CLOUD_STT, FOOD_MEAL_PROFILE, FINANCE_LEDGER, FINANCE_RECEIPT} <= set(ids)


def test_toggleable_match_features():
    catalog_toggle = {u["id"] for u in catalog.use_cases() if u.get("toggleable")}
    assert catalog_toggle == set(TOGGLEABLE_IDS)


def test_notes_alias_to_voice():
    assert catalog.canonical_module("notes") == "voice"
    matched = catalog.match_use("notes", "Cloud transcribe")
    assert matched is not None
    assert matched["id"] == VOICE_CLOUD_STT


def test_overview_empty(data_dir):
    ov = catalog.overview()
    assert ov["ok"] is True
    assert ov["fx"]["usd_inr"] == 88.0
    mods = {m["id"] for m in ov["modules"]}
    assert mods >= {"voice", "food", "finance"}
    assert ov["totals"]["calls"] == 0
    assert ov["totals"]["cost_inr"] == 0.0
    voice = next(m for m in ov["modules"] if m["id"] == "voice")
    titles = [u["id"] for u in voice["use_cases"]]
    assert VOICE_NOTE_TITLE in titles
    assert catalog.VOICE_LOCAL_STT in titles


def test_overview_spend_and_inr(data_dir):
    path = ai_usage.USAGE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {
            "id": "a",
            "ts": "2026-09-18T04:00:00Z",
            "module": "voice",
            "action": "Note title",
            "model": "deepseek-v4-flash",
            "provider": "deepseek",
            "ok": True,
            "prompt_tokens": 100,
            "completion_tokens": 10,
            "cache_hit_tokens": 0,
            "cache_miss_tokens": 100,
            "cost_usd": 0.0001,
        },
        {
            "id": "b",
            "ts": "2026-09-18T04:01:00Z",
            "module": "notes",
            "action": "Cloud transcribe",
            "model": "whisper-1",
            "provider": "openai",
            "ok": True,
            "duration_sec": 60,
            "cost_usd": 0.006,
        },
    ]
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    ov = catalog.overview()
    voice = next(m for m in ov["modules"] if m["id"] == "voice")
    assert voice["calls"] == 2
    assert voice["cost_usd"] > 0
    assert voice["cost_inr"] == pytest.approx(voice["cost_usd"] * 88.0, rel=1e-6)
    title = next(u for u in voice["use_cases"] if u["id"] == VOICE_NOTE_TITLE)
    cloud = next(u for u in voice["use_cases"] if u["id"] == VOICE_CLOUD_STT)
    assert title["calls"] == 1
    assert cloud["calls"] == 1
    assert any(c.get("use_id") == VOICE_CLOUD_STT for c in ov["calls"])


def test_voice_title_prompt_is_live(data_dir):
    d = catalog.detail(VOICE_NOTE_TITLE)
    assert d is not None
    assert "3 to 8 words" in d["prompt"]["system"]
    assert "{transcript}" in d["prompt"]["user_template"]
    names = [v["name"] for v in d["variables"]]
    assert "transcript" in names


def test_finance_prompt_includes_docs(data_dir):
    d = catalog.detail(FINANCE_LEDGER)
    assert d is not None
    assert d["prompt"]["docs"]
    assert any(x["name"] == "PARSE_TASK.md" and x["text"] for x in d["prompt"]["docs"])
    assert any(x["name"] == "OVERVIEW.md" and x["text"] for x in d["prompt"]["docs"])
    assert "ALLOWED TYPES" in d["prompt"]["user_template"]
    assert d["module"] is not None
    assert d["module"]["href"] == "/finance"


def test_keys_never_leak_secret(data_dir, monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-secret-do-not-leak")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-secret")
    dumped = json.dumps(catalog.overview())
    assert "sk-secret" not in dumped
    assert "sk-openai" not in dumped
    keys = {k["id"]: k for k in catalog.keys_payload()}
    assert keys["deepseek"]["set"] is True
    assert keys["openai"]["set"] is True
