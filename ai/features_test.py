"""Per-use-case flags (isolated TOOLKIT_DATA)."""

from __future__ import annotations

import pytest

from ai import features
import notes_ai
from food import ai as food_ai
import stt


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("TOOLKIT_DATA", str(tmp_path))
    return tmp_path


def test_default_on(data_dir):
    assert features.is_on(features.VOICE_NOTE_TITLE) is True
    assert features.flags()[features.VOICE_NOTE_TITLE] is True


def test_toggle_persists(data_dir):
    features.set_on(features.VOICE_NOTE_TITLE, False)
    assert features.is_on(features.VOICE_NOTE_TITLE) is False
    assert (data_dir / "ai" / "config.json").is_file()
    features.set_on(features.VOICE_NOTE_TITLE, True)
    assert features.is_on(features.VOICE_NOTE_TITLE) is True


def test_unknown_feature(data_dir):
    with pytest.raises(ValueError, match="Unknown"):
        features.set_on("cfa.something", False)


def test_notes_title_respects_flag(data_dir, monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    assert notes_ai.is_enabled() is True
    features.set_on(features.VOICE_NOTE_TITLE, False)
    assert notes_ai.is_enabled() is False
    assert notes_ai.status_payload()["api_key_set"] is True
    assert notes_ai.status_payload()["feature_on"] is False
    assert notes_ai.title_from_transcript("hello there this is a test") is None


def test_food_respects_flag(data_dir, monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    assert food_ai.is_enabled() is True
    features.set_on(features.FOOD_MEAL_PROFILE, False)
    assert food_ai.is_enabled() is False
    with pytest.raises(food_ai.FoodAIError, match="turned off"):
        food_ai.analyze({"food": "poha", "constitutes": []})


def test_stt_cloud_respects_flag(data_dir, monkeypatch):
    monkeypatch.setenv("TOOLKIT_PROFILE", "local")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert stt.options()["cloud_feature_on"] is True
    features.set_on(features.VOICE_CLOUD_STT, False)
    assert stt.options()["cloud_feature_on"] is False
    assert stt.options()["cloud_ready"] is True
    with pytest.raises(stt.STTError, match="turned off"):
        stt.resolve_stt("cloud")
