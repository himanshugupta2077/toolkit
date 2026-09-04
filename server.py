#!/usr/bin/env python3
"""
Toolkit server — phone-to-laptop apps over Tailscale: notes, finance, food, CFA.
"""

from __future__ import annotations

import atexit
import json
import os
import queue as waitqueue
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

# Finance tracker (phone form → JSONL + local xlsx Ledger)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from finance import sync as finance_sync  # noqa: E402
from finance import ai_parse as finance_ai  # noqa: E402
from cfa import store as cfa_store  # noqa: E402
from food import store as food_store  # noqa: E402
from food import ai as food_ai  # noqa: E402
import ai_usage  # noqa: E402
import app_log  # noqa: E402
from app_log import log, log_finance  # noqa: E402


def _nvidia_cuda_lib_dirs() -> list[Path]:
    dirs: list[Path] = []
    seen: set[str] = set()
    for root in map(Path, sys.path):
        nvidia = root / "nvidia"
        if not nvidia.is_dir():
            continue
        for d in nvidia.glob("*/lib"):
            key = str(d)
            if d.is_dir() and key not in seen:
                seen.add(key)
                dirs.append(d)
    return dirs


def _preload_nvidia_cuda_libs() -> list[str]:
    """Make pip CUDA 12 libs visible to CTranslate2 on Linux.

    nvidia-cublas-cu12 ships libcublas.so.12 under site-packages/nvidia/cublas/lib
    but CTranslate2 only registers those dirs on Windows. Model load can succeed
    and then transcribe fails with: Library libcublas.so.12 is not found.
    Changing LD_LIBRARY_PATH after process start is not enough; preload by path.
    """
    import ctypes

    lib_dirs = _nvidia_cuda_lib_dirs()
    loaded: list[str] = []
    if not lib_dirs:
        return loaded

    extra = [str(d) for d in lib_dirs]
    current = [p for p in os.environ.get("LD_LIBRARY_PATH", "").split(os.pathsep) if p]
    os.environ["LD_LIBRARY_PATH"] = os.pathsep.join(
        extra + [p for p in current if p not in extra]
    )

    # cublas depends on cublasLt; load Lt first.
    names = (
        "libcublasLt.so.12",
        "libcublas.so.12",
        "libnvrtc.so.12",
        "libcudnn.so.9",
    )
    for name in names:
        for d in lib_dirs:
            path = d / name
            if not path.is_file():
                continue
            try:
                ctypes.CDLL(str(path), mode=ctypes.RTLD_GLOBAL)
                loaded.append(name)
            except OSError:
                pass
            break
    return loaded


_cuda_libs_preloaded = _preload_nvidia_cuda_libs()

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
AUDIO_DIR = DATA / "audio"
NOTES_DIR = DATA / "notes"
FINANCE_DIR = DATA / "finance"
RECEIPTS_DIR = FINANCE_DIR / "receipts"
STATIC_DIR = ROOT / "static"
HEART_DIR = ROOT / "heart"
HEART_MEDIA_DIR = HEART_DIR / "media"
HEART_RESULTS = HEART_DIR / "results.jsonl"
CFA_DIR = DATA / "cfa"
FOOD_DIR = DATA / "food"
QUEUE_ALERTS_PATH = DATA / "queue-alerts.jsonl"
QUEUE_BATCH_URL = os.environ.get("QUEUE_BATCH_URL", "http://127.0.0.1:3847").rstrip("/")
QUEUE_ALERTS_MAX = 80
VAPID_PATH = DATA / "vapid.json"
PUSH_SUBS_PATH = DATA / "push-subs.json"
VAPID_MAILTO = os.environ.get("VAPID_MAILTO", "mailto:himanshu@localhost")

AI_DIR = DATA / "ai"

for d in (
    AUDIO_DIR,
    NOTES_DIR,
    FINANCE_DIR,
    RECEIPTS_DIR,
    STATIC_DIR,
    AI_DIR,
    CFA_DIR,
    FOOD_DIR,
    app_log.LOG_DIR,
):
    d.mkdir(parents=True, exist_ok=True)

# Whisper settings (override with env vars if you want)
# Quality ladder (worst→best): tiny < base < small < medium < large-v3
AVAILABLE_MODELS = ["tiny", "base", "small", "medium", "large-v3"]
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "medium")
if WHISPER_MODEL not in AVAILABLE_MODELS:
    WHISPER_MODEL = "medium"
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")  # "cuda" or "cpu"
# Optional hard override; if unset we pick a VRAM-safe compute type per model.
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "").strip() or None
# Optional default language lock (empty = auto). UI can override per request.
_lang = os.environ.get("WHISPER_LANGUAGE", "").strip().lower()
WHISPER_LANGUAGE = _lang if _lang and _lang not in {"auto", "none", "-"} else None

# GPU sharing: free VRAM after idle so local LLMs (3B–10B) can run.
#   >0  = seconds to keep model warm after last job (fast back-to-back notes)
#    0  = unload immediately when each job finishes
#   <0  = never auto-unload (old "hog GPU forever" behavior)
try:
    WHISPER_KEEP_ALIVE_SEC = float(os.environ.get("WHISPER_KEEP_ALIVE_SEC", "45"))
except ValueError:
    WHISPER_KEEP_ALIVE_SEC = 45.0

# One loaded model at a time (switching frees VRAM)
_model = None
_model_name: str | None = None
_model_compute: str | None = None
_model_device: str | None = None
_model_lock = threading.Lock()
_active_jobs = 0
_idle_timer: threading.Timer | None = None
_idle_timer_lock = threading.Lock()
_last_used_at: float | None = None

# Graceful + hard shutdown (Whisper/CTranslate2 native code can ignore SIGINT)
_uvicorn_server = None  # set in main()
_sigint_count = 0
_shutdown_started = False
_hard_exit_timer: threading.Timer | None = None
# Seconds to wait for clean stop before force-killing the process
SHUTDOWN_FORCE_AFTER_SEC = float(os.environ.get("SHUTDOWN_FORCE_AFTER_SEC", "2.5"))


def normalize_model_name(name: str | None) -> str:
    n = (name or WHISPER_MODEL or "medium").strip().lower()
    if n not in AVAILABLE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model '{name}'. Choose one of: {', '.join(AVAILABLE_MODELS)}",
        )
    return n


def parse_bool(value: str | bool | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _is_oom_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(
        s in msg
        for s in (
            "out of memory",
            "cuda out of memory",
            "oom",
            "failed to allocate",
            "cnmem",
            "cudnn_status_alloc_failed",
        )
    )


def _is_cuda_lib_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(
        s in msg
        for s in (
            "libcublas",
            "libcudart",
            "libcudnn",
            "libnvrtc",
            "not found or cannot be loaded",
        )
    )


def _cuda_cleanup() -> None:
    """Best-effort free of GPU memory after unloading a model."""
    import gc

    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            try:
                torch.cuda.ipc_collect()
            except Exception:
                pass
            # Small sync so free blocks are actually reclaimable
            try:
                torch.cuda.synchronize()
            except Exception:
                pass
    except Exception:
        pass
    gc.collect()


def _cancel_idle_timer() -> None:
    global _idle_timer
    with _idle_timer_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
            _idle_timer = None


def _idle_unload_callback() -> None:
    """Timer fired: free GPU if nothing is transcribing."""
    with _model_lock:
        if _active_jobs > 0:
            return
        if _model is None:
            return
        log(
            "whisper",
            f"idle unload after {WHISPER_KEEP_ALIVE_SEC:g}s "
            f"(model={_model_name})",
        )
        unload_model_unlocked()


def schedule_idle_unload() -> None:
    """
    After a job finishes, free VRAM once idle long enough.

    Keeps the model warm for a short window so rapid notes stay fast,
    then releases the GPU for local AI / other work.
    """
    global _idle_timer
    if WHISPER_KEEP_ALIVE_SEC < 0:
        return  # keep resident forever
    delay = 0.0 if WHISPER_KEEP_ALIVE_SEC == 0 else WHISPER_KEEP_ALIVE_SEC
    with _idle_timer_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
        _idle_timer = threading.Timer(delay, _idle_unload_callback)
        _idle_timer.daemon = True
        _idle_timer.start()


def unload_model_unlocked() -> None:
    """Drop the resident model and reclaim GPU memory. Caller holds _model_lock."""
    global _model, _model_name, _model_compute, _model_device
    if _model is None:
        return
    log("whisper", f"unloading model={_model_name} compute={_model_compute}")
    held = _model
    _model = None
    _model_name = None
    _model_compute = None
    _model_device = None
    try:
        del held
    except Exception:
        pass
    _cuda_cleanup()


def unload_model() -> None:
    """Thread-safe unload (cancels pending idle timer)."""
    _cancel_idle_timer()
    with _model_lock:
        unload_model_unlocked()


def _cleanup_models_best_effort() -> None:
    """Unload Whisper + free CUDA during shutdown (may be partial if mid-transcribe)."""
    try:
        _cancel_idle_timer()
    except Exception:
        pass
    try:
        with _model_lock:
            unload_model_unlocked()
    except Exception:
        pass
    try:
        _cuda_cleanup()
    except Exception:
        pass


def _hard_exit_now(code: int = 130) -> None:
    """Immediate process exit — required when CTranslate2 blocks Python threads."""
    _cleanup_models_best_effort()
    # os._exit skips finally/atexit waiters that may themselves hang on native code
    os._exit(code)


def _schedule_hard_exit(code: int = 130) -> None:
    """If uvicorn cannot drain (Whisper stuck in C++), kill the process soon."""
    global _hard_exit_timer
    delay = max(0.5, SHUTDOWN_FORCE_AFTER_SEC)

    def _fire() -> None:
        log(
            "server",
            f"still busy after {delay:g}s "
            f"(likely Whisper native code) — force exit",
            level="warn",
        )
        _hard_exit_now(code)

    if _hard_exit_timer is not None:
        try:
            _hard_exit_timer.cancel()
        except Exception:
            pass
    _hard_exit_timer = threading.Timer(delay, _fire)
    _hard_exit_timer.daemon = True
    _hard_exit_timer.start()


def _request_shutdown(reason: str) -> None:
    """Ask uvicorn to stop; schedule hard exit if a job is stuck in CTranslate2."""
    global _shutdown_started
    if _shutdown_started:
        return
    _shutdown_started = True
    log("server", f"shutting down ({reason})...")
    srv = _uvicorn_server
    if srv is not None:
        srv.should_exit = True
        # force_exit tells uvicorn not to wait forever on open connections
        srv.force_exit = True
    _schedule_hard_exit(130 if reason == "SIGINT" else 143)


def _handle_sigint(signum: int, frame) -> None:  # noqa: ARG001
    """First Ctrl+C: stop cleanly. Second: kill immediately."""
    global _sigint_count
    _sigint_count += 1
    if _sigint_count >= 2:
        log("server", "second Ctrl+C — force exit now", level="warn")
        _hard_exit_now(130)
    log("server", "Ctrl+C — stopping (press again to force-kill)...")
    _request_shutdown("SIGINT")


def _handle_sigterm(signum: int, frame) -> None:  # noqa: ARG001
    _request_shutdown("SIGTERM")


def compute_type_candidates(model_name: str) -> list[tuple[str, str]]:
    """
    Ordered (device, compute_type) attempts.

    RTX 3060 Laptop is 6GB — large-v3 float16 often OOMs if anything else
    is using VRAM. Prefer int8* for large; fall back on OOM.
    """
    if WHISPER_DEVICE == "cpu":
        return [("cpu", WHISPER_COMPUTE or "int8")]

    if WHISPER_COMPUTE:
        # User pinned a compute type; still allow int8/cpu fallbacks on OOM.
        pinned = WHISPER_COMPUTE
        extras = [c for c in ("int8_float16", "int8") if c != pinned]
        return (
            [("cuda", pinned)]
            + [("cuda", c) for c in extras]
            + [("cpu", "int8")]
        )

    # large-v3 weights alone ~3GB fp16; with browser/desktop VRAM use, 6GB dies.
    # int8_float16 keeps good quality with much lower VRAM.
    if model_name == "large-v3":
        return [
            ("cuda", "int8_float16"),
            ("cuda", "int8"),
            ("cpu", "int8"),
        ]
    if model_name == "medium":
        return [
            ("cuda", "float16"),
            ("cuda", "int8_float16"),
            ("cuda", "int8"),
            ("cpu", "int8"),
        ]
    # tiny/base/small are small enough for float16 on 6GB
    return [
        ("cuda", "float16"),
        ("cuda", "int8"),
        ("cpu", "int8"),
    ]


def _load_whisper(wanted: str, device: str, compute: str):
    """Load a model into the global slot (caller must hold _model_lock)."""
    global _model, _model_name, _model_compute, _model_device
    from faster_whisper import WhisperModel

    log("whisper", f"loading model={wanted} device={device} compute={compute}")
    _model = WhisperModel(wanted, device=device, compute_type=compute)
    _model_name = wanted
    _model_compute = compute
    _model_device = device
    log("whisper", f"model ready: {wanted} ({device}/{compute})")
    return _model


def get_model(model_name: str | None = None, *, force_cpu: bool = False):
    """Load (or reuse) a Whisper model. Only one kept in memory."""
    global _model, _model_name, _model_compute, _model_device, _last_used_at
    wanted = normalize_model_name(model_name)

    # Don't auto-unload while we're about to use / load the model
    _cancel_idle_timer()

    with _model_lock:
        if _model is not None and _model_name == wanted:
            if force_cpu:
                # OOM fallback path — reuse only if already on CPU
                if _model_device == "cpu":
                    _last_used_at = time.time()
                    return _model
            else:
                # Prefer GPU when configured. If a prior OOM left us on CPU only,
                # fall through and try CUDA again on the next real job.
                if not (_model_device == "cpu" and WHISPER_DEVICE == "cuda"):
                    _last_used_at = time.time()
                    return _model

        # Drop previous model to free GPU memory before loading another
        unload_model_unlocked()
        # Extra pass: CTranslate2 sometimes keeps CUDA blocks after del
        if force_cpu or WHISPER_DEVICE == "cuda":
            _cuda_cleanup()

        if force_cpu:
            try:
                if wanted == "large-v3":
                    log(
                        "whisper",
                        "loading large-v3 on CPU — "
                        "expect multi-minute runtime; progress lines will print",
                        level="warn",
                    )
                m = _load_whisper(wanted, "cpu", "int8")
                _last_used_at = time.time()
                return m
            except Exception as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"CPU load of '{wanted}' failed: {e}",
                ) from e

        last_err: BaseException | None = None
        for device, compute in compute_type_candidates(wanted):
            try:
                m = _load_whisper(wanted, device, compute)
                _last_used_at = time.time()
                return m
            except Exception as e:
                last_err = e
                log(
                    "whisper",
                    f"load failed ({device}/{compute}): {e}",
                    level="warn",
                )
                _model = None
                _model_name = None
                _model_compute = None
                _model_device = None
                _cuda_cleanup()

        detail = (
            f"Could not load model '{wanted}' (GPU out of memory). "
            f"Try medium, free VRAM, or set WHISPER_DEVICE=cpu. "
            f"Last error: {last_err}"
        )
        raise HTTPException(status_code=503, detail=detail) from last_err


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def safe_stem(name: str) -> str:
    name = re.sub(r"[^\w.\-]+", "_", name.strip())[:80]
    return name or "note"


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write bytes safely: temp file + fsync + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".partial")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def load_note(note_id: str) -> dict[str, Any] | None:
    path = NOTES_DIR / f"{note_id}.json"
    if not path.is_file():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_notes() -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    for p in sorted(NOTES_DIR.glob("*.json"), reverse=True):
        try:
            with open(p, "r", encoding="utf-8") as f:
                notes.append(json.load(f))
        except (json.JSONDecodeError, OSError):
            continue
    notes.sort(key=lambda n: n.get("created_at", ""), reverse=True)
    return notes


def convert_to_whisper_wav(src: Path, dest: Path) -> Path:
    """
    Browser .webm/.m4a is a bad direct input for Whisper:
    - Chrome MediaRecorder often writes WebM with Duration: N/A
    - Opus @ 48 kHz is not what Whisper expects

    Always decode with ffmpeg → 16 kHz mono PCM WAV (Whisper's native format).
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Must end in .wav so ffmpeg can pick the muxer (".wav.partial" fails)
    tmp = dest.with_name(dest.stem + ".partial.wav")
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        # Boost quiet phone mics; fall back below if loudnorm chokes on short clips
        "-af",
        "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        str(tmp),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        log(
            "ffmpeg",
            f"loudnorm failed, retrying plain convert: {e.stderr}",
            level="warn",
        )
        cmd_plain = [
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
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            str(tmp),
        ]
        try:
            subprocess.run(cmd_plain, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as e2:
            raise RuntimeError(
                f"ffmpeg convert failed: {e2.stderr or e2}"
            ) from e2

    os.replace(tmp, dest)
    size = dest.stat().st_size
    if size < 1000:
        raise RuntimeError(f"Converted WAV too small ({size} bytes) — bad source audio?")
    log("ffmpeg", f"{src.name} → {dest.name} ({size} bytes, 16kHz mono)")
    return dest


def transcribe_file(
    audio_path: Path,
    *,
    model_name: str | None = None,
    translate: bool = False,
    language: str | None = None,
) -> dict[str, Any]:
    """
    Convert browser audio → 16kHz WAV, then run faster-whisper on the WAV only.

    translate=False → task=transcribe (write what was said: Hinglish stays Hinglish)
    translate=True  → task=translate  (Whisper translates into English)

    Uses the GPU for the job, then schedules idle unload so VRAM is free for
    local LLMs / other work after a short keep-alive window.
    """
    global _active_jobs, _last_used_at

    wav_path = audio_path.with_suffix(".wav")
    # Always re-convert so we never feed raw webm/m4a to Whisper
    if audio_path.suffix.lower() != ".wav" or audio_path.resolve() != wav_path.resolve():
        convert_to_whisper_wav(audio_path, wav_path)
    elif not wav_path.is_file():
        convert_to_whisper_wav(audio_path, wav_path)

    chosen_model = normalize_model_name(model_name)
    with _model_lock:
        _active_jobs += 1
    try:
        model = get_model(chosen_model)
        t0 = time.perf_counter()

        task = "translate" if translate else "transcribe"
        # For pure transcription, auto language. For translate, Whisper still detects
        # source language then outputs English — optional language locks the source.
        lang = language if language is not None else WHISPER_LANGUAGE

        # large-v3 on 6GB: smaller beam saves activation VRAM during decode
        # (desktop + browser often already eat 2–3GB of the 6GB)
        beam = 2 if chosen_model == "large-v3" else 5

        kwargs: dict[str, Any] = {
            "beam_size": beam,
            "task": task,
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 500,
            },
            "condition_on_previous_text": True,
            "word_timestamps": False,
        }
        if lang:
            kwargs["language"] = lang

        def _run_transcribe(m, label: str, run_kwargs: dict[str, Any]):
            """Run transcribe and materialize segments with progress logs."""
            log(
                "whisper",
                f"{task} {wav_path.name} "
                f"model={chosen_model} lang={lang or 'auto'} "
                f"device={_model_device}/{_model_compute} ({label})",
            )
            segs, inf = m.transcribe(str(wav_path), **run_kwargs)
            # Materialize iterator so OOM mid-decode is caught; log so CPU
            # large-v3 does not look "stuck".
            out: list[Any] = []
            last_log = time.perf_counter()
            for i, seg in enumerate(segs):
                out.append(seg)
                now = time.perf_counter()
                if i == 0 or (i + 1) % 8 == 0 or (now - last_log) >= 15.0:
                    log(
                        "whisper",
                        f"… segments={i + 1} "
                        f"audio_t={getattr(seg, 'end', 0):.1f}s "
                        f"device={_model_device}",
                    )
                    last_log = now
            log(
                "whisper",
                f"decode done: {len(out)} segments "
                f"device={_model_device}/{_model_compute}",
            )
            return out, inf

        try:
            segment_list, info = _run_transcribe(model, "primary", kwargs)
        except Exception as e:
            cuda_job = (_model_device or "cuda") == "cuda"
            if cuda_job and _is_cuda_lib_error(e):
                log(
                    "whisper",
                    f"CUDA libs unusable → CPU int8: {e}",
                    level="warn",
                )
                model = get_model(chosen_model, force_cpu=True)
                cpu_kwargs = dict(kwargs)
                cpu_kwargs["beam_size"] = min(int(cpu_kwargs.get("beam_size") or 5), 2)
                segment_list, info = _run_transcribe(
                    model, "cpu-fallback", cpu_kwargs
                )
            elif not (_is_oom_error(e) and cuda_job):
                raise
            else:
                # 1) Same GPU weights, minimal decode cost (often enough on 6GB)
                low_vram = dict(kwargs)
                low_vram["beam_size"] = 1
                low_vram["condition_on_previous_text"] = False
                log(
                    "whisper",
                    f"OOM during transcribe → retry GPU low-VRAM "
                    f"(beam=1, no prev-text): {e}",
                    level="warn",
                )
                try:
                    _cuda_cleanup()
                    segment_list, info = _run_transcribe(
                        model, "gpu-low-vram", low_vram
                    )
                except Exception as e2:
                    if not _is_oom_error(e2):
                        raise
                    # 2) CPU int8 — correct but slow (large-v3 can look hung)
                    log(
                        "whisper",
                        f"OOM again → CPU int8 "
                        f"(large models are slow here; watch progress lines): {e2}",
                        level="warn",
                    )
                    model = get_model(chosen_model, force_cpu=True)
                    # Prefer low-VRAM kwargs on CPU too (faster, less RAM)
                    segment_list, info = _run_transcribe(
                        model, "cpu-fallback", low_vram
                    )

        parts: list[str] = []
        segment_rows: list[dict[str, Any]] = []
        for seg in segment_list:
            text = (seg.text or "").strip()
            if not text:
                continue
            parts.append(text)
            segment_rows.append(
                {
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": text,
                }
            )

        # Join with space; Whisper already includes leading spaces in segment text often
        transcript = " ".join(parts).strip()
        # Collapse weird multi-spaces
        transcript = re.sub(r" +", " ", transcript)
        elapsed = round(time.perf_counter() - t0, 2)
        device_str = f"{_model_device or WHISPER_DEVICE}/{_model_compute or ''}".rstrip("/")
        _last_used_at = time.time()

        return {
            "transcript": transcript,
            "language": info.language,
            "language_probability": round(float(info.language_probability), 4),
            "segments": segment_rows,
            "processing_seconds": elapsed,
            "model": chosen_model,
            "device": device_str,
            "task": task,
            "translate": translate,
            "wav_file": wav_path.name,
            "duration": round(float(info.duration), 2) if getattr(info, "duration", None) else None,
        }
    finally:
        with _model_lock:
            _active_jobs = max(0, _active_jobs - 1)
            still_busy = _active_jobs > 0
        # Free GPU after idle keep-alive (or immediately if KEEP_ALIVE=0)
        if not still_busy:
            schedule_idle_unload()


app = FastAPI(title="Toolkit", version="1.1.0")


@app.get("/api/health")
def health():
    with _model_lock:
        loaded = _model_name
        device = _model_device
        compute = _model_compute
        busy = _active_jobs
        last_used = _last_used_at
    return {
        "ok": True,
        "time": utc_now_iso(),
        "whisper_model": WHISPER_MODEL,
        "whisper_device": WHISPER_DEVICE,
        "whisper_language": WHISPER_LANGUAGE,
        "loaded_model": loaded,
        "loaded_device": f"{device}/{compute}".rstrip("/") if loaded else None,
        "active_jobs": busy,
        "keep_alive_sec": WHISPER_KEEP_ALIVE_SEC,
        "last_used_at": (
            datetime.fromtimestamp(last_used, tz=timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            if last_used
            else None
        ),
        "available_models": AVAILABLE_MODELS,
        "notes_count": len(list(NOTES_DIR.glob("*.json"))),
        "queue_batch_url": QUEUE_BATCH_URL,
    }


# ---------------------------------------------------------------------------
# ChatGPT prompt-queue alerts (batch-server → phone via this app)
# ---------------------------------------------------------------------------

_queue_lock = threading.Lock()
_sse_lock = threading.Lock()
_sse_clients: list[waitqueue.Queue] = []
_vapid_cache: dict[str, str] | None = None


def _read_queue_alerts() -> list[dict[str, Any]]:
    if not QUEUE_ALERTS_PATH.is_file():
        return []
    out: list[dict[str, Any]] = []
    try:
        raw = QUEUE_ALERTS_PATH.read_text(encoding="utf-8")
    except OSError:
        return []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and obj.get("id"):
            out.append(obj)
    return out


def _write_queue_alerts(alerts: list[dict[str, Any]]) -> None:
    QUEUE_ALERTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = QUEUE_ALERTS_PATH.with_suffix(".jsonl.tmp")
    body = "".join(json.dumps(a, ensure_ascii=False) + "\n" for a in alerts[-QUEUE_ALERTS_MAX:])
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(QUEUE_ALERTS_PATH)


def _load_vapid() -> dict[str, str]:
    global _vapid_cache
    if _vapid_cache:
        return _vapid_cache
    if VAPID_PATH.is_file():
        try:
            data = json.loads(VAPID_PATH.read_text(encoding="utf-8"))
            if data.get("private_pem") and data.get("public_key"):
                _vapid_cache = data
                return data
        except (OSError, json.JSONDecodeError):
            pass
    from base64 import urlsafe_b64encode

    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    from py_vapid import Vapid

    vapid = Vapid()
    vapid.generate_keys()
    raw = vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    data = {
        "private_pem": vapid.private_pem().decode("utf-8"),
        "public_pem": vapid.public_pem().decode("utf-8"),
        "public_key": urlsafe_b64encode(raw).rstrip(b"=").decode("ascii"),
    }
    VAPID_PATH.parent.mkdir(parents=True, exist_ok=True)
    VAPID_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    _vapid_cache = data
    log("queue", "generated VAPID keys for Web Push")
    return data


def _read_push_subs() -> list[dict[str, Any]]:
    if not PUSH_SUBS_PATH.is_file():
        return []
    try:
        data = json.loads(PUSH_SUBS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def _write_push_subs(subs: list[dict[str, Any]]) -> None:
    PUSH_SUBS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PUSH_SUBS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(subs, indent=2), encoding="utf-8")
    tmp.replace(PUSH_SUBS_PATH)


def _broadcast_alert(alert: dict[str, Any]) -> None:
    with _sse_lock:
        clients = list(_sse_clients)
    for q in clients:
        try:
            q.put_nowait(alert)
        except waitqueue.Full:
            pass


def _send_web_push(alert: dict[str, Any]) -> None:
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        log("queue", "pywebpush missing — lock-screen push disabled", level="warn")
        return
    vapid = _load_vapid()
    payload = json.dumps(
        {
            "title": alert.get("title") or "ChatGPT queue",
            "body": alert.get("message") or "",
            "message": alert.get("message") or "",
            "kind": alert.get("kind") or "",
            "id": alert.get("id") or "",
        }
    )
    with _queue_lock:
        subs = _read_push_subs()
    if not subs:
        log("queue", "no phone push subscriptions yet")
        return
    keep: list[dict[str, Any]] = []
    sent = 0
    for sub in subs:
        info = {
            "endpoint": sub.get("endpoint"),
            "keys": sub.get("keys") or {},
        }
        if not info["endpoint"] or not info["keys"].get("p256dh") or not info["keys"].get("auth"):
            continue
        try:
            webpush(
                subscription_info=info,
                data=payload,
                vapid_private_key=vapid["private_pem"],
                vapid_claims={"sub": VAPID_MAILTO},
                ttl=86400,
                timeout=8,
            )
            keep.append(sub)
            sent += 1
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in {404, 410}:
                log("queue", f"drop stale push sub ({status})")
                continue
            log("queue", f"web push failed: {e}", level="warn")
            keep.append(sub)
        except Exception as e:
            log("queue", f"web push failed: {e}", level="warn")
            keep.append(sub)
    if len(keep) != len(subs):
        with _queue_lock:
            _write_push_subs(keep)
    log("queue", f"web push sent={sent} subs={len(keep)}")


def _fetch_batch_status() -> dict[str, Any]:
    url = f"{QUEUE_BATCH_URL}/api/status"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=2.5) as resp:
            data = json.loads(resp.read().decode("utf-8") or "{}")
        if isinstance(data, dict):
            data["ok"] = True
            data["up"] = True
            return data
        return {"ok": False, "up": True, "error": "bad status payload"}
    except Exception as e:
        return {"ok": False, "up": False, "error": str(e)}


@app.post("/api/queue/alert")
def api_queue_alert(body: dict[str, Any] = Body(...)):
    kind = str(body.get("kind") or body.get("type") or "").strip()
    if kind not in {"halt", "rate_limit", "batch_finished"}:
        raise HTTPException(status_code=400, detail="kind must be halt, rate_limit, or batch_finished")
    title = str(body.get("title") or "").strip() or "ChatGPT queue"
    message = str(body.get("message") or "").strip()
    alert = {
        "id": str(body.get("id") or uuid.uuid4().hex[:12]),
        "ts": str(body.get("ts") or utc_now_iso()),
        "kind": kind,
        "title": title,
        "message": message,
        "acked": False,
    }
    with _queue_lock:
        alerts = _read_queue_alerts()
        alerts.append(alert)
        _write_queue_alerts(alerts)
    log("queue", f"{kind}: {title} — {message[:160]}")
    _broadcast_alert(alert)
    threading.Thread(target=_send_web_push, args=(alert,), daemon=True).start()
    return {"ok": True, "alert": alert}


@app.get("/api/queue/alerts")
def api_queue_alerts(limit: int = 20):
    n = max(1, min(int(limit or 20), 80))
    with _queue_lock:
        alerts = _read_queue_alerts()
    unread = [a for a in alerts if not a.get("acked")]
    return {
        "ok": True,
        "alerts": list(reversed(alerts[-n:])),
        "unread": list(reversed(unread[-n:])),
        "unreadCount": len(unread),
    }


@app.post("/api/queue/alerts/ack")
def api_queue_ack(body: dict[str, Any] | None = Body(default=None)):
    body = body or {}
    ack_all = bool(body.get("all"))
    ack_id = str(body.get("id") or "").strip()
    with _queue_lock:
        alerts = _read_queue_alerts()
        changed = 0
        for a in alerts:
            if a.get("acked"):
                continue
            if ack_all or (ack_id and a.get("id") == ack_id):
                a["acked"] = True
                changed += 1
        if changed:
            _write_queue_alerts(alerts)
    return {"ok": True, "acked": changed}


@app.get("/api/queue/vapid")
def api_queue_vapid():
    return {"ok": True, "publicKey": _load_vapid()["public_key"]}


@app.post("/api/queue/push-sub")
def api_queue_push_sub(body: dict[str, Any] = Body(...)):
    endpoint = str(body.get("endpoint") or "").strip()
    keys = body.get("keys") if isinstance(body.get("keys"), dict) else {}
    p256dh = str(keys.get("p256dh") or "").strip()
    auth = str(keys.get("auth") or "").strip()
    if not endpoint.startswith("https://") or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="invalid push subscription")
    sub = {
        "endpoint": endpoint,
        "keys": {"p256dh": p256dh, "auth": auth},
        "addedAt": utc_now_iso(),
    }
    with _queue_lock:
        subs = [s for s in _read_push_subs() if s.get("endpoint") != endpoint]
        subs.append(sub)
        _write_push_subs(subs[-20:])
    log("queue", f"push subscription saved ({len(subs)} device(s))")
    return {"ok": True, "devices": len(subs)}


@app.get("/api/queue/stream")
def api_queue_stream():
    q: waitqueue.Queue = waitqueue.Queue(maxsize=8)
    with _sse_lock:
        _sse_clients.append(q)

    def gen():
        try:
            yield "event: hello\ndata: {}\n\n"
            while True:
                try:
                    item = q.get(timeout=25)
                    yield f"event: alert\ndata: {json.dumps(item)}\n\n"
                except waitqueue.Empty:
                    yield ": keepalive\n\n"
        finally:
            with _sse_lock:
                if q in _sse_clients:
                    _sse_clients.remove(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/queue/status")
def api_queue_status():
    batch = _fetch_batch_status()
    with _queue_lock:
        alerts = _read_queue_alerts()
    unread = [a for a in alerts if not a.get("acked")]
    latest = unread[-1] if unread else (alerts[-1] if alerts else None)
    return {
        "ok": True,
        "batch": batch,
        "latest": latest,
        "unreadCount": len(unread),
    }


# ---------------------------------------------------------------------------
# Finance tracker
# ---------------------------------------------------------------------------


@app.get("/api/finance/options")
def api_finance_options():
    """Dropdowns + defaults for the finance form."""
    return finance_sync.options_payload()


@app.get("/api/finance/dashboard")
def api_finance_dashboard():
    """Simple Dashboard metrics (computed from live workbook)."""
    payload = finance_sync.simple_dashboard_payload()
    if not payload.get("ok"):
        raise HTTPException(
            status_code=500,
            detail=payload.get("error") or "Dashboard unavailable",
        )
    return payload


@app.get("/api/finance/transactions")
def api_finance_transactions(year: int | None = None, month: int | None = None):
    """
    Ledger rows for a calendar month (phone Finance UI).
    Defaults to current month in FINANCE_TZ. Optional year + month query params.
    """
    payload = finance_sync.month_transactions_payload(year=year, month=month)
    if not payload.get("ok"):
        raise HTTPException(
            status_code=500,
            detail=payload.get("error") or "Transactions unavailable",
        )
    return payload


@app.get("/api/finance/transactions/{row}")
def api_finance_transaction_get(row: int):
    """One Ledger row by sheet row number (for edit form)."""
    payload = finance_sync.get_ledger_transaction(row)
    if not payload.get("ok"):
        err = payload.get("error") or "Not found"
        code = 404 if "not found" in str(err).lower() or "empty" in str(err).lower() else 500
        raise HTTPException(status_code=code, detail=err)
    return payload


@app.put("/api/finance/transactions/{row}")
async def api_finance_transaction_update(row: int, body: dict[str, Any] = Body(...)):
    """Surgically update one Ledger row (content fields)."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Expected JSON object")
    try:
        result = finance_sync.update_ledger_row(row, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}") from e
    if not result.get("ok"):
        err = result.get("error") or "Update failed"
        code = 404 if "not found" in str(err).lower() or "empty" in str(err).lower() else 500
        raise HTTPException(status_code=code, detail=err)
    entry = result.get("entry") or {}
    log_finance(
        f"update row {row} {entry.get('type')} ₹{entry.get('amount')} "
        f"{entry.get('category')} {entry.get('from_account', '?')}→{entry.get('to_account', '?')}",
        source="manual",
        extra={"row": row, "action": "update"},
    )
    return result


@app.delete("/api/finance/transactions/{row}")
def api_finance_transaction_delete(row: int):
    """Surgically delete one Ledger row."""
    try:
        result = finance_sync.delete_ledger_row(row)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}") from e
    if not result.get("ok"):
        err = result.get("error") or "Delete failed"
        code = 404 if "not found" in str(err).lower() or "empty" in str(err).lower() else 500
        raise HTTPException(status_code=code, detail=err)
    deleted = result.get("deleted") or {}
    log_finance(
        f"delete row {row} {deleted.get('type')} ₹{deleted.get('amount')} "
        f"{deleted.get('category')}",
        source="manual",
        extra={"row": row, "action": "delete"},
    )
    return result


@app.get("/api/finance/entries")
def api_finance_list(limit: int = 20):
    lim = max(1, min(int(limit or 20), 100))
    return {"entries": finance_sync.recent_entries(lim)}


@app.get("/api/finance/ai-status")
def api_finance_ai_status():
    """DeepSeek config status for the UI (no secrets)."""
    return finance_ai.status_payload()


@app.get("/api/ai/usage")
def api_ai_usage(limit: int = 100):
    """
    All AI API calls + estimated spend (DeepSeek pricing).
    Shared across modules (finance today; more later).
    """
    lim = max(1, min(int(limit or 100), 500))
    return ai_usage.usage_summary(limit=lim)


@app.get("/api/activity")
def api_activity(limit: int = 100, tag: str = ""):
    """
    Recent pipeline / server activity (upload, ffmpeg, whisper, finance, …).

    Same events as the colored terminal tags; persisted in data/logs/activity.jsonl.
    Optional ?tag=whisper|upload|finance:ai|… filters by tag.
    """
    lim = max(1, min(int(limit or 100), 500))
    want = (tag or "").strip() or None
    rows = app_log.recent(limit=lim, tag=want)
    return {
        "events": rows,
        "count": len(rows),
        "path": str(app_log.ACTIVITY_PATH),
    }


@app.post("/api/finance/parse")
async def api_finance_parse(body: dict[str, Any] = Body(...)):
    """
    Parse text → Ledger row(s) via DeepSeek (no audio).

    Body: { "text": "...", "save": true|false }
    When save is true (default), appends via sync.add_entry with source=ai.
    """
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Expected JSON object")
    text = str(body.get("text") or body.get("transcript") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    do_save = parse_bool(body.get("save"), True)

    try:
        if do_save:
            result = finance_ai.parse_and_save(text, source="ai")
        else:
            result = finance_ai.parse_transcript(text)
    except finance_ai.AIParseError as e:
        raise HTTPException(
            status_code=400 if e.status in {"empty", "config"} else 502,
            detail=str(e),
        ) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI parse failed: {e}") from e

    if result.get("ok") and result.get("entries"):
        for entry in result["entries"]:
            if isinstance(entry, dict) and entry.get("id"):
                sheet = entry.get("sheet") or {}
                sheet_bit = (
                    f"sheet=row {sheet.get('row')}"
                    if sheet.get("ok")
                    else f"sheet=FAIL {sheet.get('error', '?')}"
                )
                log_finance(
                    f"{entry['id']} {entry.get('type')} "
                    f"₹{entry.get('amount')} {entry.get('category')} "
                    f"{entry.get('from_account', '?')}→{entry.get('to_account', '?')} "
                    f"source={entry.get('source', 'ai')} {sheet_bit}",
                    source=str(entry.get("source") or "ai"),
                    extra={"entry_id": entry.get("id")},
                )
    return result


@app.post("/api/finance/receipt")
async def api_finance_receipt(
    images: list[UploadFile] = File(default=[]),
    note: str = Form(""),
    audio: UploadFile | None = File(None),
    model: str = Form(""),
    translate: str = Form("false"),
    save: str = Form("true"),
):
    """
    Receipt / purchase screenshots → DeepSeek → **one** Ledger row (source=ai).

    Multipart form:
      images   — one or more image files (required)
      note     — optional typed note
      audio    — optional voice note (Whisper → text, merged into note)
      model    — Whisper model when audio is sent
      translate— Whisper translate flag
      save     — true (default) append Ledger; false parse-only
    """
    # FastAPI may deliver a single file when only one is uploaded
    if images is None:
        images = []
    if not isinstance(images, list):
        images = [images]

    # Some clients send empty file parts — drop them
    upload_list = [f for f in images if f is not None and getattr(f, "filename", None) != ""]
    if not upload_list:
        raise HTTPException(status_code=400, detail="At least one image is required")

    receipt_id = uuid.uuid4().hex[:12]
    created = utc_now_iso()
    dest_dir = RECEIPTS_DIR / receipt_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    image_payloads: list[dict[str, Any]] = []
    saved_names: list[str] = []
    try:
        for idx, up in enumerate(upload_list):
            raw = await up.read()
            if not raw:
                continue
            if len(raw) > 12 * 1024 * 1024:
                raise HTTPException(
                    status_code=413,
                    detail=f"Image {idx + 1} larger than 12MB",
                )
            fname = Path(up.filename or f"img{idx + 1}.jpg").name
            # Keep a simple safe name on disk
            ext = Path(fname).suffix.lower()
            if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}:
                ct = (up.content_type or "").lower()
                if "png" in ct:
                    ext = ".png"
                elif "webp" in ct:
                    ext = ".webp"
                elif "gif" in ct:
                    ext = ".gif"
                else:
                    ext = ".jpg"
            disk_name = f"{idx + 1:02d}{ext}"
            atomic_write_bytes(dest_dir / disk_name, raw)
            saved_names.append(disk_name)
            image_payloads.append(
                {
                    "data": raw,
                    "filename": fname,
                    "content_type": up.content_type or "",
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read images: {e}") from e

    if not image_payloads:
        raise HTTPException(status_code=400, detail="At least one non-empty image is required")

    note_text = (note or "").strip()
    voice_transcript = ""
    audio_name: str | None = None

    # Optional voice note → Whisper (same stack as Audio Notes)
    if audio is not None and (audio.filename or audio.content_type):
        raw_audio = await audio.read()
        if raw_audio:
            a_fname = audio.filename or "voice.webm"
            a_ext = Path(a_fname).suffix.lower()
            if a_ext not in {".webm", ".ogg", ".mp3", ".wav", ".m4a", ".mp4", ".aac"}:
                ctype = (audio.content_type or "").lower()
                if "ogg" in ctype:
                    a_ext = ".ogg"
                elif "mp4" in ctype or "m4a" in ctype:
                    a_ext = ".m4a"
                elif "mpeg" in ctype or "mp3" in ctype:
                    a_ext = ".mp3"
                elif "wav" in ctype:
                    a_ext = ".wav"
                else:
                    a_ext = ".webm"
            audio_name = f"voice{a_ext}"
            audio_path = dest_dir / audio_name
            atomic_write_bytes(audio_path, raw_audio)
            log("upload", f"receipt {receipt_id} voice ({len(raw_audio)} bytes)")
            try:
                chosen_model = normalize_model_name(model or None)
                do_translate = parse_bool(translate, False)
                tr = transcribe_file(
                    audio_path,
                    model_name=chosen_model,
                    translate=do_translate,
                )
                voice_transcript = (tr.get("transcript") or "").strip()
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Voice note transcription failed: {e}",
                ) from e

    if voice_transcript:
        if note_text:
            note_text = f"{note_text}\n{voice_transcript}".strip()
        else:
            note_text = voice_transcript

    do_save = parse_bool(save, True)
    meta_path = dest_dir / "meta.json"
    meta_doc: dict[str, Any] = {
        "id": receipt_id,
        "created_at": created,
        "images": saved_names,
        "audio_file": audio_name,
        "note": (note or "").strip(),
        "voice_transcript": voice_transcript or None,
        "combined_note": note_text or None,
    }

    try:
        if do_save:
            result = finance_ai.parse_and_save_receipt(
                image_payloads,
                note_text,
                source="ai",
                note_id=receipt_id,
            )
        else:
            result = finance_ai.parse_receipt(image_payloads, note_text)
    except finance_ai.AIParseError as e:
        meta_doc["error"] = str(e)
        meta_doc["status"] = e.status
        try:
            atomic_write_text(meta_path, json.dumps(meta_doc, indent=2))
        except OSError:
            pass
        raise HTTPException(
            status_code=400
            if e.status in {"empty", "config", "validation"}
            else 502,
            detail=str(e),
        ) from e
    except Exception as e:
        meta_doc["error"] = str(e)
        try:
            atomic_write_text(meta_path, json.dumps(meta_doc, indent=2))
        except OSError:
            pass
        raise HTTPException(
            status_code=500, detail=f"Receipt AI failed: {e}"
        ) from e

    meta_doc["result"] = {
        "ok": result.get("ok"),
        "status": result.get("status"),
        "receipt_path": result.get("receipt_path"),
        "error": result.get("error"),
        "entries": [
            {
                "id": e.get("id"),
                "amount": e.get("amount"),
                "category": e.get("category"),
                "type": e.get("type"),
                "sheet": e.get("sheet"),
            }
            for e in (result.get("entries") or [])
            if isinstance(e, dict)
        ],
    }
    try:
        atomic_write_text(meta_path, json.dumps(meta_doc, indent=2))
    except OSError:
        pass

    if result.get("ok") and result.get("entries"):
        for entry in result["entries"]:
            if not isinstance(entry, dict) or not entry.get("id"):
                continue
            sheet = entry.get("sheet") or {}
            sheet_bit = (
                f"sheet=row {sheet.get('row')}"
                if sheet.get("ok")
                else f"sheet=FAIL {sheet.get('error', '?')}"
            )
            log_finance(
                f"receipt {receipt_id} → {entry['id']} {entry.get('type')} "
                f"₹{entry.get('amount')} {entry.get('category')} "
                f"source=ai path={result.get('receipt_path')} {sheet_bit}",
                source="ai",
                extra={
                    "receipt_id": receipt_id,
                    "entry_id": entry.get("id"),
                },
            )
    else:
        log_finance(
            f"receipt {receipt_id} no entry: {result.get('error') or result.get('status')}",
            source="ai",
            level="warn",
            extra={"receipt_id": receipt_id},
        )

    # UI-friendly envelope
    return {
        **result,
        "receipt_id": receipt_id,
        "note": note_text,
        "voice_transcript": voice_transcript or None,
        "image_count": len(image_payloads),
    }


@app.post("/api/finance/entries")
async def api_finance_create(body: dict[str, Any] = Body(...)):
    """Add one transaction: JSONL log + Ledger row in local xlsx."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Expected JSON object")
    # Phone form is always manual unless explicitly tagged
    if not body.get("source"):
        body = {**body, "source": "manual"}
    try:
        entry = finance_sync.add_entry(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save entry: {e}") from e

    sheet = entry.get("sheet") or {}
    sheet_bit = (
        f"sheet=row {sheet.get('row')}"
        if sheet.get("ok")
        else f"sheet=FAIL {sheet.get('error', '?')}"
    )
    log_finance(
        f"{entry['id']} {entry['type']} ₹{entry['amount']:g} "
        f"{entry['category']} {entry.get('from_account', '?')}→{entry.get('to_account', '?')} "
        f"source={entry.get('source', 'manual')} {sheet_bit}",
        source=str(entry.get("source") or "manual"),
        extra={"entry_id": entry.get("id")},
    )
    return entry


@app.post("/api/whisper/unload")
def api_whisper_unload():
    """
    Force-free GPU now (e.g. before starting a local LLM).

    Safe if nothing is loaded. Refuses while a transcription is in flight.
    """
    with _model_lock:
        if _active_jobs > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot unload: {_active_jobs} transcription job(s) still running",
            )
        was = _model_name
        unload_model_unlocked()
    _cancel_idle_timer()
    return {
        "ok": True,
        "unloaded": was,
        "message": "GPU freed" if was else "Nothing was loaded",
    }


@app.get("/api/options")
def api_options():
    """UI dropdowns / defaults for the web app."""
    return {
        "models": [
            {"id": "tiny", "label": "tiny"},
            {"id": "base", "label": "base"},
            {"id": "small", "label": "small"},
            {"id": "medium", "label": "medium"},
            {"id": "large-v3", "label": "large-v3"},
        ],
        "default_model": WHISPER_MODEL,
        "default_translate": False,
    }


@app.get("/api/notes")
def api_list_notes():
    return {"notes": list_notes()}


@app.get("/api/notes/{note_id}")
def api_get_note(note_id: str):
    note = load_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@app.patch("/api/notes/{note_id}")
async def api_update_note(note_id: str, body: dict[str, Any] = Body(...)):
    """Update note metadata (currently: title)."""
    note = load_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if "title" not in body:
        raise HTTPException(status_code=400, detail="No updatable fields provided")

    new_title = str(body.get("title") or "").strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    if len(new_title) > 120:
        raise HTTPException(status_code=400, detail="Title too long (max 120)")

    note["title"] = new_title
    note["updated_at"] = utc_now_iso()

    json_path = NOTES_DIR / f"{note_id}.json"
    txt_path = NOTES_DIR / f"{note_id}.txt"
    atomic_write_text(json_path, json.dumps(note, indent=2))

    transcript = note.get("transcript") or ""
    if note.get("status") == "error" and note.get("error"):
        txt_body = f"{new_title}\n\n[transcription failed]\n{note['error']}\n"
    else:
        txt_body = f"{new_title}\n{note.get('created_at', '')}\n\n{transcript}\n"
    atomic_write_text(txt_path, txt_body)

    log("note", f"{note_id} title updated → {new_title!r}")
    return note


@app.post("/api/notes")
async def api_create_note(
    audio: UploadFile = File(...),
    title: str = Form(""),
    client_id: str = Form(""),
    model: str = Form(""),
    translate: str = Form("false"),
    update_ledger: str = Form("false"),
):
    """
    Accept a recorded audio blob, save it to disk, transcribe, save note JSON.

    Form fields from the web app:
      model          — tiny|base|small|medium|large-v3
      translate      — true → English translation; false → as-spoken transcript
      update_ledger  — true → after Whisper, parse with DeepSeek and append Ledger
                       row(s) (source=ai). Surgical append only; never rebuilds sheets.
    """
    note_id = uuid.uuid4().hex[:12]
    created = utc_now_iso()
    do_translate = parse_bool(translate, False)
    do_ledger = parse_bool(update_ledger, False)
    chosen_model = normalize_model_name(model or None)

    # Detect extension from content-type / filename
    filename = audio.filename or "recording.webm"
    ext = Path(filename).suffix.lower()
    if ext not in {".webm", ".ogg", ".mp3", ".wav", ".m4a", ".mp4", ".aac"}:
        ctype = (audio.content_type or "").lower()
        if "ogg" in ctype:
            ext = ".ogg"
        elif "mp4" in ctype or "m4a" in ctype:
            ext = ".m4a"
        elif "mpeg" in ctype or "mp3" in ctype:
            ext = ".mp3"
        elif "wav" in ctype:
            ext = ".wav"
        else:
            ext = ".webm"

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(raw) > 200 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio larger than 200MB")

    audio_name = f"{note_id}{ext}"
    audio_path = AUDIO_DIR / audio_name

    # 1) Persist audio first (before any heavy work)
    atomic_write_bytes(audio_path, raw)
    log("upload", f"saved {audio_path} ({len(raw)} bytes)")

    display_title = (title or "").strip() or f"Note {created[:16].replace('T', ' ')}"

    # 2) Convert + transcribe (never feed raw .webm to Whisper)
    try:
        result = transcribe_file(
            audio_path,
            model_name=chosen_model,
            translate=do_translate,
        )
    except HTTPException:
        raise
    except Exception as e:
        # Keep the audio even if transcription fails
        note = {
            "id": note_id,
            "title": display_title,
            "created_at": created,
            "status": "error",
            "error": str(e),
            "audio_file": audio_name,
            "audio_bytes": len(raw),
            "transcript": "",
            "model": chosen_model,
            "translate": do_translate,
            "client_id": client_id or None,
        }
        atomic_write_text(NOTES_DIR / f"{note_id}.json", json.dumps(note, indent=2))
        # Also drop a plain .txt so you can open notes easily
        atomic_write_text(NOTES_DIR / f"{note_id}.txt", f"{display_title}\n\n[transcription failed]\n{e}\n")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}") from e

    note = {
        "id": note_id,
        "title": display_title,
        "created_at": created,
        "status": "ready",
        "audio_file": audio_name,
        "wav_file": result.get("wav_file"),
        "audio_bytes": len(raw),
        "transcript": result["transcript"],
        "language": result["language"],
        "language_probability": result["language_probability"],
        "segments": result["segments"],
        "processing_seconds": result["processing_seconds"],
        "duration": result.get("duration"),
        "model": result["model"],
        "device": result["device"],
        "task": result.get("task"),
        "translate": result.get("translate", False),
        "client_id": client_id or None,
        "update_ledger": do_ledger,
    }

    # Optional: transcript → DeepSeek JSON → surgical Ledger append (source=ai)
    finance_result: dict[str, Any] | None = None
    if do_ledger:
        transcript_text = (result.get("transcript") or "").strip()
        if not transcript_text:
            finance_result = {
                "ok": False,
                "status": "no_transcript",
                "error": "Empty transcript; nothing to add to ledger",
                "entries": [],
            }
        else:
            try:
                finance_result = finance_ai.parse_and_save(
                    transcript_text,
                    source="ai",
                    note_id=note_id,
                )
            except finance_ai.AIParseError as e:
                finance_result = {
                    "ok": False,
                    "status": e.status,
                    "error": str(e),
                    "entries": [],
                }
            except Exception as e:
                finance_result = {
                    "ok": False,
                    "status": "error",
                    "error": f"Ledger AI failed: {e}",
                    "entries": [],
                }
        note["finance"] = finance_result
        if finance_result and finance_result.get("ok"):
            saved = finance_result.get("entries") or []
            for entry in saved:
                if not isinstance(entry, dict):
                    continue
                sheet = entry.get("sheet") or {}
                sheet_bit = (
                    f"sheet=row {sheet.get('row')}"
                    if sheet.get("ok")
                    else f"sheet=FAIL {sheet.get('error', '?')}"
                )
                log_finance(
                    f"from note {note_id} → {entry.get('id')} "
                    f"{entry.get('type')} ₹{entry.get('amount')} "
                    f"{entry.get('category')} source=ai {sheet_bit}",
                    source="ai",
                    extra={
                        "note_id": note_id,
                        "entry_id": entry.get("id"),
                    },
                )
        else:
            err = (finance_result or {}).get("error") or "unknown"
            log_finance(
                f"note {note_id} ledger skip/fail: {err}",
                source="ai",
                level="warn",
                extra={"note_id": note_id},
            )

    json_path = NOTES_DIR / f"{note_id}.json"
    txt_path = NOTES_DIR / f"{note_id}.txt"
    atomic_write_text(json_path, json.dumps(note, indent=2))
    txt_extra = ""
    if do_ledger and finance_result is not None:
        if finance_result.get("ok"):
            n = len(finance_result.get("entries") or [])
            txt_extra = f"\n\n[ledger] saved {n} entr{'y' if n == 1 else 'ies'} (source=ai)\n"
        else:
            txt_extra = f"\n\n[ledger] not saved: {finance_result.get('error')}\n"
    atomic_write_text(
        txt_path,
        f"{display_title}\n{created}\n\n{result['transcript']}{txt_extra}\n",
    )
    log(
        "note",
        f"{note_id} ready — {len(result['transcript'])} chars "
        f"in {result['processing_seconds']}s lang={result['language']} "
        f"task={result.get('task')} model={result['model']}"
        f"{' ledger=on' if do_ledger else ''}",
        extra={"note_id": note_id, "chars": len(result["transcript"])},
    )
    log("note", f"audio: {audio_path}")
    log("note", f"text:  {txt_path}")
    if result.get("wav_file"):
        log("note", f"wav:   {AUDIO_DIR / result['wav_file']}")

    return note


@app.post("/api/notes/{note_id}/retranscribe")
async def api_retranscribe(
    note_id: str,
    model: str = Form(""),
    translate: str = Form("false"),
):
    """Re-run convert+whisper on an existing saved audio (no re-record needed)."""
    note = load_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    audio_name = note.get("audio_file")
    if not audio_name:
        raise HTTPException(status_code=400, detail="Note has no audio_file")
    audio_path = AUDIO_DIR / Path(audio_name).name
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail=f"Audio missing: {audio_name}")

    do_translate = parse_bool(translate, False)
    chosen_model = normalize_model_name(model or note.get("model") or None)

    try:
        result = transcribe_file(
            audio_path,
            model_name=chosen_model,
            translate=do_translate,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}") from e

    note.update(
        {
            "status": "ready",
            "error": None,
            "wav_file": result.get("wav_file"),
            "transcript": result["transcript"],
            "language": result["language"],
            "language_probability": result["language_probability"],
            "segments": result["segments"],
            "processing_seconds": result["processing_seconds"],
            "duration": result.get("duration"),
            "model": result["model"],
            "device": result["device"],
            "task": result.get("task"),
            "translate": result.get("translate", False),
            "retranscribed_at": utc_now_iso(),
        }
    )
    json_path = NOTES_DIR / f"{note_id}.json"
    txt_path = NOTES_DIR / f"{note_id}.txt"
    atomic_write_text(json_path, json.dumps(note, indent=2))
    atomic_write_text(
        txt_path,
        f"{note.get('title', note_id)}\n{note.get('created_at', '')}\n\n{result['transcript']}\n",
    )
    log(
        "note",
        f"{note_id} retranscribed — {len(result['transcript'])} chars "
        f"in {result['processing_seconds']}s lang={result['language']} "
        f"task={result.get('task')} model={result['model']}",
        extra={"note_id": note_id, "chars": len(result["transcript"])},
    )
    log("note", f"audio: {audio_path}")
    log("note", f"text:  {txt_path}")
    if result.get("wav_file"):
        log("note", f"wav:   {AUDIO_DIR / result['wav_file']}")
    return note


@app.delete("/api/notes/{note_id}")
def api_delete_note(note_id: str):
    note = load_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    files_to_drop = [
        NOTES_DIR / f"{note_id}.json",
        NOTES_DIR / f"{note_id}.txt",
        AUDIO_DIR / Path(note.get("audio_file") or "").name,
        AUDIO_DIR / Path(note.get("wav_file") or f"{note_id}.wav").name,
    ]
    for p in files_to_drop:
        if p and p.name and p.is_file():
            try:
                p.unlink()
            except OSError:
                pass
    return {"ok": True, "id": note_id}


# Serve audio files (for playback in the UI)
@app.get("/api/audio/{filename}")
def api_audio(filename: str):
    # Prevent path traversal
    safe = Path(filename).name
    path = AUDIO_DIR / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(path)


# ---------------------------------------------------------------------------
# Heart — saved Instagram posts + AI metadata browser
# ---------------------------------------------------------------------------

_heart_catalog_cache: dict[str, Any] | None = None
_heart_catalog_mtime: float | None = None


def _load_heart_catalog(force: bool = False) -> dict[str, Any]:
    """Parse results.jsonl into a compact catalog (cached by mtime)."""
    global _heart_catalog_cache, _heart_catalog_mtime

    if not HEART_RESULTS.is_file():
        return {"total": 0, "analyzed": 0, "categories": [], "posts": []}

    try:
        mtime = HEART_RESULTS.stat().st_mtime
    except OSError:
        mtime = None

    if (
        not force
        and _heart_catalog_cache is not None
        and mtime is not None
        and _heart_catalog_mtime == mtime
    ):
        return _heart_catalog_cache

    posts: list[dict[str, Any]] = []
    cat_counts: dict[str, int] = {}
    tag_counts: dict[str, dict[str, int]] = {}
    total = 0
    analyzed = 0

    try:
        text = HEART_RESULTS.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot read results: {e}") from e

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        total += 1
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not row.get("ok"):
            continue
        analysis = row.get("analysis") or {}
        meta = analysis.get("metadata") or {}
        category = (analysis.get("category_id") or "other").strip() or "other"
        tags = [str(t).strip() for t in (analysis.get("tags") or []) if str(t).strip()]
        suggested = [
            str(t).strip()
            for t in (analysis.get("suggested_tags") or [])
            if str(t).strip()
        ]
        files_raw = row.get("files") or []
        files: list[dict[str, Any]] = []
        for f in files_raw:
            if not isinstance(f, dict):
                continue
            name = str(f.get("name") or "").strip()
            if not name or name in {".", ".."} or "/" in name or "\\" in name:
                continue
            files.append(
                {
                    "name": name,
                    "type": f.get("type") or "",
                    "size": f.get("size"),
                }
            )

        post_id = str(row.get("postId") or "").strip()
        if not post_id:
            continue

        analyzed += 1
        cat_counts[category] = cat_counts.get(category, 0) + 1
        if category not in tag_counts:
            tag_counts[category] = {}
        for t in tags:
            tag_counts[category][t] = tag_counts[category].get(t, 0) + 1

        # Prefer an image thumb; fall back to first file
        thumb = None
        for f in files:
            t = (f.get("type") or "").lower()
            n = f["name"].lower()
            if t.startswith("image/") or n.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
                thumb = f["name"]
                break
        if thumb is None and files:
            thumb = files[0]["name"]

        has_video = any(
            (f.get("type") or "").lower().startswith("video/")
            or f["name"].lower().endswith((".mp4", ".webm", ".mov"))
            for f in files
        )
        has_image = any(
            (f.get("type") or "").lower().startswith("image/")
            or f["name"].lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))
            for f in files
        )

        posts.append(
            {
                "id": post_id,
                "category": category,
                "tags": tags,
                "suggested_tags": suggested,
                "title": meta.get("title") or post_id,
                "summary": meta.get("summary") or "",
                "content_type": meta.get("content_type") or "",
                "keywords": meta.get("keywords") or [],
                "primary_subjects": meta.get("primary_subjects") or [],
                "secondary_subjects": meta.get("secondary_subjects") or [],
                "objects": meta.get("objects") or [],
                "activities": meta.get("activities") or [],
                "locations": meta.get("locations") or [],
                "brands": meta.get("brands") or [],
                "people": meta.get("people") or [],
                "text_visible": meta.get("text_visible") or [],
                "confidence": meta.get("confidence"),
                "files": files,
                "thumb": thumb,
                "has_video": has_video,
                "has_image": has_image,
                "file_count": len(files),
                "analyzed_at": row.get("analyzedAt"),
            }
        )

    # Stable sort: category then title
    posts.sort(key=lambda p: (p["category"], (p["title"] or "").lower(), p["id"]))

    categories = [
        {
            "id": cid,
            "count": cat_counts[cid],
            "tags": [
                {"id": tid, "count": n}
                for tid, n in sorted(
                    tag_counts.get(cid, {}).items(),
                    key=lambda x: (-x[1], x[0].lower()),
                )
            ],
        }
        for cid in sorted(cat_counts.keys(), key=lambda c: (-cat_counts[c], c.lower()))
    ]

    catalog = {
        "total": total,
        "analyzed": analyzed,
        "categories": categories,
        "posts": posts,
    }
    _heart_catalog_cache = catalog
    _heart_catalog_mtime = mtime
    return catalog


@app.get("/api/heart/catalog")
def api_heart_catalog():
    """Full catalog of AI-analyzed posts for the Heart browser."""
    return _load_heart_catalog()


@app.get("/api/heart/media/{post_id}/{filename}")
def api_heart_media(post_id: str, filename: str):
    """Serve a local media file for a post (path-traversal safe)."""
    safe_id = Path(post_id).name
    safe_name = Path(filename).name
    if not safe_id or safe_id in {".", ".."} or not safe_name or safe_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid path")
    path = (HEART_MEDIA_DIR / safe_id / safe_name).resolve()
    try:
        path.relative_to(HEART_MEDIA_DIR.resolve())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid path") from e
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Media not found")
    return FileResponse(path)


@app.get("/api/cfa")
def api_cfa_get():
    return cfa_store.get_state()


@app.put("/api/cfa")
def api_cfa_put(body: dict[str, Any] = Body(...)):
    return cfa_store.save_state(body)


def _food_commit_log(body: dict[str, Any], *, replace_id: str | None = None) -> dict[str, Any]:
    try:
        preview = food_store.preview_log(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    analysis: dict[str, Any] | None = None
    ai_error: str | None = None
    analyzed = "catalog"
    if preview["needs_ai"] and food_ai.is_enabled():
        try:
            analysis = food_ai.analyze(
                preview["entry"], catalog=preview["catalog"]
            )
            analyzed = "ai"
        except food_ai.FoodAIError as e:
            ai_error = str(e)
            log("food:ai", ai_error, level="warn")
    try:
        result = food_store.commit_log(
            preview["entry"],
            analysis=analysis,
            replace_id=replace_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    result["analyzed"] = analyzed if analysis else "catalog"
    result["aiError"] = ai_error
    result["needs_ai"] = preview["needs_ai"]
    entry = result.get("entry") or {}
    log(
        "food",
        f"{'update' if replace_id else 'log'} {entry.get('food')} "
        f"{entry.get('date')} {entry.get('time')}",
    )
    if analysis:
        log("food:ai", f"profiled {entry.get('food')}")
    return result


@app.get("/api/food")
def api_food():
    data = food_store.bootstrap()
    data["ai"] = food_ai.status_payload()
    return data


@app.post("/api/food/logs")
def api_food_log_create(body: dict[str, Any] = Body(...)):
    return _food_commit_log(body)


@app.put("/api/food/logs/{log_id}")
def api_food_log_update(log_id: str, body: dict[str, Any] = Body(...)):
    payload = dict(body)
    payload["id"] = log_id
    return _food_commit_log(payload, replace_id=log_id)


@app.delete("/api/food/logs/{log_id}")
def api_food_log_delete(log_id: str):
    try:
        result = food_store.delete_log(log_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Log not found") from e
    log("food", f"delete log {log_id}")
    return result


@app.post("/api/food/plans")
def api_food_plan_create(body: dict[str, Any] = Body(...)):
    try:
        result = food_store.commit_plan(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    entry = result.get("entry") or {}
    log(
        "food",
        f"plan {entry.get('food')} {entry.get('date')} {entry.get('time')}",
    )
    return result


@app.put("/api/food/plans/{plan_id}")
def api_food_plan_update(plan_id: str, body: dict[str, Any] = Body(...)):
    payload = dict(body)
    payload["id"] = plan_id
    try:
        result = food_store.commit_plan(payload, replace_id=plan_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    entry = result.get("entry") or {}
    log(
        "food",
        f"update plan {entry.get('food')} {entry.get('date')} {entry.get('time')}",
    )
    return result


@app.delete("/api/food/plans/{plan_id}")
def api_food_plan_delete(plan_id: str):
    try:
        result = food_store.delete_plan(plan_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Plan not found") from e
    log("food", f"delete plan {plan_id}")
    return result


# Static frontend
@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")


@app.get("/cfa")
@app.get("/cfa/")
def cfa_index():
    return FileResponse(ROOT / "cfa" / "index.html")


@app.get("/food")
@app.get("/food/")
def food_index():
    return FileResponse(ROOT / "food" / "index.html")


@app.get("/sw.js")
def service_worker():
    return FileResponse(
        ROOT / "sw.js",
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache",
            "Service-Worker-Allowed": "/",
        },
    )


@app.get("/manifest.webmanifest")
def web_manifest():
    return FileResponse(
        ROOT / "manifest.webmanifest",
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


# Optional: mount /static if you add CSS/JS files later
if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def main():
    global _uvicorn_server
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    log("server", f"Audio Notes server → http://{host}:{port}")
    log("server", f"Data directory     → {DATA}")
    log("server", f"Whisper            → {WHISPER_MODEL} on {WHISPER_DEVICE}")
    if WHISPER_DEVICE == "cuda":
        if "libcublas.so.12" in _cuda_libs_preloaded:
            log("server", "CUDA libs          → preloaded cublas from venv")
        else:
            log(
                "server",
                "CUDA libs          → libcublas.so.12 not preloaded; GPU transcribe may fail",
                level="warn",
            )
    if WHISPER_KEEP_ALIVE_SEC < 0:
        log("server", "GPU keep-alive    → always resident (no auto-unload)")
    elif WHISPER_KEEP_ALIVE_SEC == 0:
        log("server", "GPU keep-alive    → unload immediately after each job")
    else:
        log(
            "server",
            f"GPU keep-alive    → unload after {WHISPER_KEEP_ALIVE_SEC:g}s idle "
            "(frees VRAM for local AI)",
        )
    log(
        "server",
        "Ctrl+C             → stop (2nd Ctrl+C or "
        f"~{SHUTDOWN_FORCE_AFTER_SEC:g}s force-kills if Whisper is stuck)",
    )
    log("server", f"Activity log      → {app_log.ACTIVITY_PATH}")
    # Optional preload — default off so the server does not hog GPU at boot.
    # First note pays a one-time load; subsequent notes within keep-alive stay warm.
    if os.environ.get("WHISPER_PRELOAD", "0") == "1":
        def _preload_and_schedule():
            try:
                get_model(WHISPER_MODEL)
            except Exception as e:
                log("whisper", f"preload failed: {e}", level="error")
                return
            schedule_idle_unload()

        threading.Thread(target=_preload_and_schedule, daemon=True).start()

    # Own signal handlers: uvicorn alone will not exit while a sync Whisper
    # job is blocked inside CTranslate2 C++ (Ctrl+C appears to "do nothing").
    atexit.register(_cleanup_models_best_effort)
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGINT, _handle_sigint)
        signal.signal(signal.SIGTERM, _handle_sigterm)

    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    _uvicorn_server = uvicorn.Server(config)
    # We installed handlers above; skip uvicorn's so double-Ctrl+C is ours.
    _uvicorn_server.install_signal_handlers = lambda: None  # type: ignore[method-assign]

    try:
        _uvicorn_server.run()
    except KeyboardInterrupt:
        log("server", "KeyboardInterrupt — exiting")
    finally:
        _cleanup_models_best_effort()
        log("server", "bye")


if __name__ == "__main__":
    main()
