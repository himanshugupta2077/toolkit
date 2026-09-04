"""
Terminal + file activity logging for the Audio Notes server.

- Colored, icon-prefixed tags on stdout (respects NO_COLOR / FORCE_COLOR)
- Structured JSONL under data/logs/activity.jsonl for every event

Usage:
    from app_log import log, log_finance
    log("upload", f"saved {path} ({n} bytes)")
    log("whisper", "OOM → CPU fallback", level="warn")
    log_finance("Expense ₹20 …", source="ai")
"""

from __future__ import annotations

import json
import os
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "data" / "logs"
ACTIVITY_PATH = LOG_DIR / "activity.jsonl"

_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Tag styles: (icon, ANSI color code for the [tag] part)
# ---------------------------------------------------------------------------

_RESET = "\033[0m"
_BOLD = "\033[1m"

# tag → (icon, fg ANSI)
_TAG_STYLE: dict[str, tuple[str, str]] = {
    "upload": ("📤", "\033[96m"),          # bright cyan
    "ffmpeg": ("🎬", "\033[95m"),          # bright magenta
    "whisper": ("🎙", "\033[93m"),         # bright yellow
    "note": ("📝", "\033[92m"),            # bright green
    "finance": ("₹", "\033[94m"),          # bright blue
    "finance:ai": ("🤖", "\033[92m"),      # bright green
    "finance:manual": ("✋", "\033[94m"),  # bright blue
    "server": ("🖥", "\033[97m"),          # bright white
    "ai": ("✨", "\033[96m"),              # cyan
    "food": ("🍛", "\033[93m"),            # yellow
    "food:ai": ("🤖", "\033[92m"),         # green
    "queue": ("📬", "\033[93m"),           # yellow
    "error": ("❌", "\033[91m"),           # bright red
    "warn": ("⚠", "\033[93m"),             # yellow
}

# Level → optional message-body tint
_LEVEL_MSG: dict[str, str] = {
    "info": "",
    "warn": "\033[33m",
    "error": "\033[31m",
    "debug": "\033[2m",
}


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _truthy(val: str | None) -> bool:
    return (val or "").strip().lower() in {"1", "true", "yes", "on"}


def _use_color() -> bool:
    """
    Color decision (highest priority first):
      FORCE_COLOR / APP_LOG_COLOR=1  → on
      NO_COLOR / APP_LOG_COLOR=0      → off
      stdout/stderr is a TTY         → on
      TERM set and not dumb          → on (helps `tee` / some launchers)
    """
    # Explicit force-on wins (useful under agents / pipes / NO_COLOR sandboxes)
    if _truthy(os.environ.get("FORCE_COLOR")) or _truthy(
        os.environ.get("APP_LOG_COLOR")
    ):
        return True
    if os.environ.get("NO_COLOR") is not None and os.environ.get("NO_COLOR") != "":
        return False
    if os.environ.get("APP_LOG_COLOR", "").strip().lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        return False
    try:
        if sys.stdout.isatty() or sys.stderr.isatty():
            return True
    except Exception:
        pass
    term = os.environ.get("TERM", "")
    if term and term not in {"dumb"}:
        # Default on for real TERMs even when not a TTY (e.g. `./run.sh | tee`)
        return True
    return False


def _normalize_tag(tag: str) -> str:
    t = (tag or "app").strip().lower().replace(" ", "")
    return t or "app"


def _style_for(tag: str) -> tuple[str, str]:
    """Return (icon, color_code); supports finance:* prefix fallback."""
    t = _normalize_tag(tag)
    if t in _TAG_STYLE:
        return _TAG_STYLE[t]
    if ":" in t:
        base = t.split(":", 1)[0]
        if base in _TAG_STYLE:
            return _TAG_STYLE[base]
    return ("•", "\033[37m")


def _format_console(tag: str, message: str, *, level: str, color: bool) -> str:
    t = _normalize_tag(tag)
    icon, tag_color = _style_for(t)
    bracket = f"[{t}]"
    if color:
        level_c = _LEVEL_MSG.get(level, "")
        tagged = f"{icon} {tag_color}{_BOLD}{bracket}{_RESET}"
        body = f"{level_c}{message}{_RESET}" if level_c else message
        return f"{tagged} {body}"
    return f"{icon} {bracket} {message}"


def _append_jsonl(record: dict[str, Any]) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, default=str) + "\n"
    with _lock:
        with ACTIVITY_PATH.open("a", encoding="utf-8") as f:
            f.write(line)


def log(
    tag: str,
    message: str,
    *,
    level: str = "info",
    also_print: bool = True,
    extra: dict[str, Any] | None = None,
    file: Any = None,
) -> None:
    """
    Log one activity event to the terminal and data/logs/activity.jsonl.

    tag:   upload | ffmpeg | whisper | note | finance:ai | finance:manual | server | …
    level: info | warn | error | debug
    extra: optional structured fields stored in JSONL only
    """
    t = _normalize_tag(tag)
    lvl = (level or "info").strip().lower()
    if lvl not in {"info", "warn", "error", "debug"}:
        lvl = "info"
    msg = str(message).rstrip("\n")

    record: dict[str, Any] = {
        "ts": _utc_now_iso(),
        "tag": t,
        "level": lvl,
        "message": msg,
    }
    if extra:
        record["extra"] = extra

    try:
        _append_jsonl(record)
    except Exception:
        pass  # never break the app for logging

    if also_print:
        out = file if file is not None else sys.stdout
        line = _format_console(t, msg, level=lvl, color=_use_color())
        try:
            print(line, file=out, flush=True)
        except Exception:
            try:
                print(f"[{t}] {msg}", flush=True)
            except Exception:
                pass


def log_finance(
    message: str,
    *,
    source: str | None = None,
    level: str = "info",
    extra: dict[str, Any] | None = None,
) -> None:
    """Pick finance / finance:ai / finance:manual from entry source."""
    src = (source or "").strip().lower()
    if src == "ai":
        tag = "finance:ai"
    elif src == "manual":
        tag = "finance:manual"
    elif src:
        tag = f"finance:{src}"
    else:
        tag = "finance"
    log(tag, message, level=level, extra=extra)


def recent(limit: int = 100, *, tag: str | None = None) -> list[dict[str, Any]]:
    """Read the last N activity records (newest last)."""
    if not ACTIVITY_PATH.is_file():
        return []
    limit = max(1, min(int(limit), 5000))
    want = _normalize_tag(tag) if tag else None
    rows: list[dict[str, Any]] = []
    try:
        with ACTIVITY_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if want and rec.get("tag") != want:
                    continue
                rows.append(rec)
    except OSError:
        return []
    return rows[-limit:]
