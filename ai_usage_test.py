"""Usage summary buckets + notes→voice alias."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

import ai_usage


@pytest.fixture
def usage_path(tmp_path, monkeypatch):
    path = tmp_path / "usage.jsonl"
    monkeypatch.setattr(ai_usage, "USAGE_PATH", path)
    monkeypatch.setattr(ai_usage, "DATA_DIR", tmp_path)
    return path


def test_summary_groups_and_alias(usage_path):
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    rows = [
        {
            "module": "notes",
            "action": "Cloud transcribe",
            "model": "whisper-1",
            "provider": "openai",
            "ok": True,
            "ts": f"{month}-15T01:00:00Z",
            "duration_sec": 60,
        },
        {
            "module": "voice",
            "action": "Note title",
            "model": "deepseek-v4-flash",
            "provider": "deepseek",
            "ok": True,
            "ts": f"{month}-15T01:01:00Z",
            "prompt_tokens": 100,
            "completion_tokens": 5,
            "cache_hit_tokens": 0,
            "cache_miss_tokens": 100,
        },
        {
            "module": "food",
            "action": "Meal profile",
            "model": "deepseek-v4-flash",
            "provider": "deepseek",
            "ok": False,
            "ts": "2026-08-01T00:00:00Z",
            "error": "nope",
        },
    ]
    usage_path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    out = ai_usage.usage_summary(limit=10)
    mods = {b["module"]: b for b in out["by_module"]}
    assert "notes" not in mods
    assert mods["voice"]["calls"] == 2
    assert mods["food"]["calls"] == 1
    actions = {(b["module"], b["action"]): b for b in out["by_action"]}
    assert ("voice", "Cloud transcribe") in actions
    assert ("voice", "Note title") in actions
    models = {b["model"] for b in out["by_model"]}
    assert "whisper-1" in models
    assert out["totals"]["calls"] == 3
    assert out["totals"]["ok_calls"] == 2
    assert out["this_month"]["calls"] >= 1
    assert len(out["by_day"]) == 14
    assert "whisper-1" in out["whisper_pricing"]
