"""Speech-to-text: local Faster Whisper, or OpenAI whisper-1 (cloud).

VPS (`TOOLKIT_PROFILE=vps`) is cloud-only. Laptop can pick either.
API key stays in env / .env — never sent to the browser.
"""

from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any

import ai_usage
from ai.features import VOICE_CLOUD_STT, is_on as feature_on
from app_log import log

CLOUD_MODEL = "whisper-1"
CLOUD_MAX_BYTES = 24 * 1024 * 1024  # OpenAI limit is 25MB
DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_TIMEOUT_SEC = 180.0
SUPPORTED_CLOUD_EXT = {
    ".flac",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".mpga",
    ".m4a",
    ".ogg",
    ".wav",
    ".webm",
}


class STTError(Exception):
    """User-visible speech-to-text failure."""

    def __init__(
        self,
        message: str,
        *,
        status: str = "error",
        http_status: int = 400,
    ):
        super().__init__(message)
        self.status = status
        self.http_status = http_status


def _truthy(raw: str) -> bool:
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _falsy(raw: str) -> bool:
    return raw.strip().lower() in {"0", "false", "no", "off"}


def profile() -> str:
    raw = (os.environ.get("TOOLKIT_PROFILE") or "local").strip().lower()
    if raw in {"vps", "cloud-only", "server"}:
        return "vps"
    return "local"


def local_enabled() -> bool:
    override = os.environ.get("TOOLKIT_STT_LOCAL", "").strip()
    if override and _falsy(override):
        return False
    if override and _truthy(override):
        return True
    return profile() != "vps"


def openai_api_key() -> str:
    return (
        os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENAI_KEY") or ""
    ).strip()


def openai_key_set() -> bool:
    return bool(openai_api_key())


def openai_base_url() -> str:
    return (os.environ.get("OPENAI_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def cloud_model() -> str:
    name = (os.environ.get("OPENAI_STT_MODEL") or CLOUD_MODEL).strip()
    return name or CLOUD_MODEL


def _timeout() -> float:
    try:
        return float(os.environ.get("OPENAI_STT_TIMEOUT_SEC") or DEFAULT_TIMEOUT_SEC)
    except ValueError:
        return DEFAULT_TIMEOUT_SEC


def default_stt() -> str:
    if not local_enabled():
        return "cloud"
    raw = (os.environ.get("TOOLKIT_STT") or "local").strip().lower()
    if raw == "cloud":
        return "cloud"
    return "local"


def options() -> dict[str, Any]:
    return {
        "profile": profile(),
        "default": default_stt(),
        "local_enabled": local_enabled(),
        "cloud_ready": openai_key_set(),
        "cloud_feature_on": feature_on(VOICE_CLOUD_STT),
        "cloud_model": cloud_model(),
    }


def resolve_stt(requested: str | None) -> str:
    want = (requested or "").strip().lower() or default_stt()
    if want not in {"local", "cloud"}:
        raise STTError(
            f"Invalid stt '{requested}'. Use local or cloud.",
            status="config",
        )
    if want == "local" and not local_enabled():
        want = "cloud"
    if want == "cloud" and not feature_on(VOICE_CLOUD_STT):
        raise STTError(
            "Cloud transcription is turned off in the AI app.",
            status="config",
        )
    if want == "cloud" and not openai_key_set():
        raise STTError(
            "OPENAI_API_KEY is not set. Add it to .env for cloud transcription.",
            status="config",
        )
    return want


def _as_dict(payload: Any) -> dict[str, Any]:
    if payload is None:
        return {}
    if isinstance(payload, dict):
        return payload
    if hasattr(payload, "model_dump"):
        try:
            dumped = payload.model_dump()
            if isinstance(dumped, dict):
                return dumped
        except Exception:
            pass
    if hasattr(payload, "to_dict"):
        try:
            dumped = payload.to_dict()
            if isinstance(dumped, dict):
                return dumped
        except Exception:
            pass
    out: dict[str, Any] = {}
    for key in ("text", "language", "duration", "segments", "usage", "task"):
        if hasattr(payload, key):
            out[key] = getattr(payload, key)
    return out


def _seg_row(seg: Any) -> dict[str, Any] | None:
    if isinstance(seg, dict):
        text = (seg.get("text") or "").strip()
        start = seg.get("start") or 0
        end = seg.get("end") or 0
    else:
        text = (getattr(seg, "text", None) or "").strip()
        start = getattr(seg, "start", 0) or 0
        end = getattr(seg, "end", 0) or 0
    if not text:
        return None
    try:
        start_f = round(float(start), 2)
        end_f = round(float(end), 2)
    except (TypeError, ValueError):
        start_f, end_f = 0.0, 0.0
    return {"start": start_f, "end": end_f, "text": text}


def _usage_seconds(usage: Any) -> float | None:
    if usage is None:
        return None
    raw = None
    if isinstance(usage, dict):
        raw = usage.get("seconds")
    else:
        raw = getattr(usage, "seconds", None)
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def normalize_cloud_payload(
    payload: Any,
    *,
    elapsed: float,
    translate: bool,
) -> dict[str, Any]:
    data = _as_dict(payload)
    transcript = re.sub(r" +", " ", (data.get("text") or "").strip())
    segments: list[dict[str, Any]] = []
    for seg in data.get("segments") or []:
        row = _seg_row(seg)
        if row:
            segments.append(row)
    duration = data.get("duration")
    usage_sec = _usage_seconds(data.get("usage"))
    duration_out: float | None = None
    if duration is not None:
        try:
            duration_out = round(float(duration), 2)
        except (TypeError, ValueError):
            duration_out = None
    if duration_out is None and usage_sec is not None:
        duration_out = round(usage_sec, 2)
    lang = data.get("language")
    if lang is not None:
        lang = str(lang).strip() or None
    return {
        "transcript": transcript,
        "language": lang,
        "language_probability": None,
        "segments": segments,
        "processing_seconds": round(float(elapsed), 2),
        "model": cloud_model(),
        "device": "openai",
        "task": "translate" if translate else "transcribe",
        "translate": translate,
        "wav_file": None,
        "duration": duration_out,
        "stt": "cloud",
        "usage_seconds": usage_sec,
    }


def _ffmpeg_mp3(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.stem + ".partial.mp3")
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        "-f",
        "mp3",
        str(tmp),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise STTError(
            f"ffmpeg compress failed: {e.stderr or e}",
            status="error",
            http_status=500,
        ) from e
    os.replace(tmp, dest)
    size = dest.stat().st_size
    if size < 200:
        raise STTError(
            f"Compressed MP3 too small ({size} bytes) — bad source audio?",
            http_status=500,
        )
    log("ffmpeg", f"{src.name} → {dest.name} ({size} bytes, mp3 for cloud STT)")
    return dest


def prepare_cloud_file(audio_path: Path) -> Path:
    """Pick a file OpenAI will accept (format + 25MB cap)."""
    src = Path(audio_path)
    if not src.is_file():
        raise STTError(f"Audio missing: {src.name}", http_status=404)
    ext = src.suffix.lower()
    size = src.stat().st_size
    if ext in SUPPORTED_CLOUD_EXT and size <= CLOUD_MAX_BYTES:
        return src
    dest = src.with_name(src.stem + ".cloud.mp3")
    out = _ffmpeg_mp3(src, dest)
    if out.stat().st_size > CLOUD_MAX_BYTES:
        raise STTError(
            "Audio is too large for OpenAI whisper-1 (25MB limit).",
            http_status=413,
        )
    return out


def _call_openai_whisper(
    audio_path: Path,
    *,
    translate: bool,
    language: str | None,
    api_key: str,
    base_url: str,
    timeout: float,
    model: str,
) -> Any:
    try:
        from openai import OpenAI
    except ImportError as e:
        raise STTError(
            "Python package 'openai' is missing in the whisper venv. "
            "Run: ./whisper/.venv/bin/pip install openai",
            status="config",
        ) from e

    client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout)
    with audio_path.open("rb") as fh:
        if translate:
            return client.audio.translations.create(
                model=model,
                file=fh,
                response_format="verbose_json",
            )
        kwargs: dict[str, Any] = {
            "model": model,
            "file": fh,
            "response_format": "verbose_json",
        }
        if language:
            kwargs["language"] = language
        return client.audio.transcriptions.create(**kwargs)


def _log_cloud_call(
    *,
    ok: bool,
    elapsed: float,
    duration_sec: float | None,
    error: str | None = None,
) -> None:
    try:
        ai_usage.log_call(
            module="voice",
            action="Cloud transcribe",
            model=cloud_model(),
            provider="openai",
            ok=ok,
            latency_sec=round(elapsed, 2),
            duration_sec=duration_sec,
            error=error,
        )
    except Exception:
        pass


def transcribe_cloud(
    audio_path: Path,
    *,
    translate: bool = False,
    language: str | None = None,
) -> dict[str, Any]:
    if not feature_on(VOICE_CLOUD_STT):
        raise STTError(
            "Cloud transcription is turned off in the AI app.",
            status="config",
        )
    key = openai_api_key()
    if not key:
        raise STTError(
            "OPENAI_API_KEY is not set. Add it to .env for cloud transcription.",
            status="config",
        )

    send_path = prepare_cloud_file(Path(audio_path))
    t0 = time.perf_counter()
    try:
        payload = _call_openai_whisper(
            send_path,
            translate=translate,
            language=language,
            api_key=key,
            base_url=openai_base_url(),
            timeout=_timeout(),
            model=cloud_model(),
        )
    except STTError:
        raise
    except Exception as e:
        elapsed = time.perf_counter() - t0
        _log_cloud_call(ok=False, elapsed=elapsed, duration_sec=None, error=str(e))
        log("whisper", f"cloud whisper-1 failed: {e}", level="error")
        raise STTError(
            f"OpenAI whisper-1 failed: {e}",
            status="error",
            http_status=502,
        ) from e

    elapsed = time.perf_counter() - t0
    result = normalize_cloud_payload(payload, elapsed=elapsed, translate=translate)
    _log_cloud_call(
        ok=True,
        elapsed=elapsed,
        duration_sec=result.get("usage_seconds") or result.get("duration"),
    )
    log(
        "whisper",
        f"cloud {result['task']} {Path(audio_path).name} "
        f"model={result['model']} lang={result.get('language') or 'auto'} "
        f"in {result['processing_seconds']}s",
    )
    return result
