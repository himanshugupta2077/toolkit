"""Local vs cloud STT config, VPS lock, whisper-1 payload normalize."""

from __future__ import annotations

from pathlib import Path

import pytest

import ai_usage
import stt


def test_profile_vps_disables_local(monkeypatch):
    monkeypatch.setenv("TOOLKIT_PROFILE", "vps")
    monkeypatch.delenv("TOOLKIT_STT_LOCAL", raising=False)
    monkeypatch.delenv("TOOLKIT_STT", raising=False)
    assert stt.profile() == "vps"
    assert stt.local_enabled() is False
    assert stt.default_stt() == "cloud"


def test_profile_local_allows_both(monkeypatch):
    monkeypatch.setenv("TOOLKIT_PROFILE", "local")
    monkeypatch.delenv("TOOLKIT_STT_LOCAL", raising=False)
    monkeypatch.setenv("TOOLKIT_STT", "local")
    assert stt.local_enabled() is True
    assert stt.default_stt() == "local"


def test_stt_local_override_on_vps(monkeypatch):
    monkeypatch.setenv("TOOLKIT_PROFILE", "vps")
    monkeypatch.setenv("TOOLKIT_STT_LOCAL", "1")
    assert stt.local_enabled() is True


def test_resolve_coerces_local_to_cloud_on_vps(monkeypatch):
    monkeypatch.setenv("TOOLKIT_PROFILE", "vps")
    monkeypatch.delenv("TOOLKIT_STT_LOCAL", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert stt.resolve_stt("local") == "cloud"
    assert stt.resolve_stt("cloud") == "cloud"
    assert stt.resolve_stt("") == "cloud"


def test_resolve_cloud_requires_key(monkeypatch):
    monkeypatch.setenv("TOOLKIT_PROFILE", "local")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_KEY", raising=False)
    with pytest.raises(stt.STTError, match="OPENAI_API_KEY"):
        stt.resolve_stt("cloud")


def test_options_hides_key(monkeypatch):
    monkeypatch.setenv("TOOLKIT_PROFILE", "local")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-do-not-leak")
    caps = stt.options()
    dumped = str(caps)
    assert "sk-secret" not in dumped
    assert caps["cloud_ready"] is True
    assert caps["cloud_model"] == "whisper-1"
    assert caps["local_enabled"] is True


def test_normalize_verbose_json():
    payload = {
        "task": "transcribe",
        "language": "english",
        "duration": 8.47,
        "text": "  hello   world ",
        "segments": [
            {"id": 0, "start": 0.0, "end": 1.5, "text": " hello"},
            {"id": 1, "start": 1.5, "end": 3.0, "text": " world"},
            {"id": 2, "start": 3.0, "end": 4.0, "text": "   "},
        ],
        "usage": {"type": "duration", "seconds": 9},
    }
    out = stt.normalize_cloud_payload(payload, elapsed=1.234, translate=False)
    assert out["transcript"] == "hello world"
    assert out["language"] == "english"
    assert out["model"] == "whisper-1"
    assert out["device"] == "openai"
    assert out["stt"] == "cloud"
    assert out["task"] == "transcribe"
    assert out["duration"] == 8.47
    assert out["usage_seconds"] == 9.0
    assert out["processing_seconds"] == 1.23
    assert out["segments"] == [
        {"start": 0.0, "end": 1.5, "text": "hello"},
        {"start": 1.5, "end": 3.0, "text": "world"},
    ]


def test_prepare_cloud_file_passes_small_webm(tmp_path: Path):
    src = tmp_path / "note.webm"
    src.write_bytes(b"fake-webm-bytes-ok")
    assert stt.prepare_cloud_file(src) == src


def test_prepare_cloud_file_compresses_when_too_big(tmp_path: Path, monkeypatch):
    src = tmp_path / "huge.webm"
    src.write_bytes(b"x" * 10)
    monkeypatch.setattr(stt, "CLOUD_MAX_BYTES", 4)

    def fake_mp3(path: Path, dest: Path) -> Path:
        dest.write_bytes(b"mp3")
        return dest

    monkeypatch.setattr(stt, "_ffmpeg_mp3", fake_mp3)
    out = stt.prepare_cloud_file(src)
    assert out.suffix == ".mp3"
    assert out.read_bytes() == b"mp3"


def test_transcribe_cloud_uses_whisper_1(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    src = tmp_path / "note.webm"
    src.write_bytes(b"fake-audio")
    seen: dict[str, object] = {}

    def fake_call(audio_path, **kwargs):
        seen["path"] = audio_path
        seen["kwargs"] = kwargs
        return {"text": "hi", "language": "en", "duration": 1.0, "segments": []}

    monkeypatch.setattr(stt, "_call_openai_whisper", fake_call)
    monkeypatch.setattr(stt, "_log_cloud_call", lambda **_k: None)
    result = stt.transcribe_cloud(src, translate=False, language=None)
    assert result["transcript"] == "hi"
    assert result["model"] == "whisper-1"
    assert seen["kwargs"]["model"] == "whisper-1"
    assert seen["kwargs"]["translate"] is False


def test_whisper_cost_per_minute():
    # $0.006 / minute → 90s = $0.009
    cost = ai_usage.estimate_cost_usd(model="whisper-1", duration_sec=90)
    assert cost == 0.009
    assert ai_usage.estimate_cost_usd(model="whisper-1") is None
