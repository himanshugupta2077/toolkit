"""Editable prompt overrides for /ai use-cases.

Stored in data/ai/prompts/{id}.json so the git-tracked defaults stay intact.
Call sites read through apply_system / apply_user_template / get.
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path
from typing import Any

from ai.features import (
    FINANCE_LEDGER,
    FINANCE_RECEIPT,
    FOOD_MEAL_PROFILE,
    VOICE_NOTE_TITLE,
)
from paths import data_root

EDITABLE_IDS: frozenset[str] = frozenset(
    {
        VOICE_NOTE_TITLE,
        FOOD_MEAL_PROFILE,
        FINANCE_LEDGER,
        FINANCE_RECEIPT,
    }
)

MAX_CHARS = 120_000
_ID_RE = re.compile(r"^[a-z0-9]+(\.[a-z0-9_]+)+$")
_lock = threading.RLock()

_EMPTY = {"system": None, "user_template": None, "docs": {}}


def prompts_dir() -> Path:
    d = data_root() / "ai" / "prompts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".partial")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _check_id(use_id: str) -> str:
    uid = (use_id or "").strip()
    if uid not in EDITABLE_IDS or not _ID_RE.match(uid):
        raise ValueError(f"Prompts are not editable for {use_id!r}")
    return uid


def _path(use_id: str) -> Path:
    return prompts_dir() / f"{_check_id(use_id)}.json"


def _normalize(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return dict(_EMPTY)
    docs_in = raw.get("docs")
    docs: dict[str, str] = {}
    if isinstance(docs_in, dict):
        for k, v in docs_in.items():
            name = str(k).strip()
            if not name or "/" in name or "\\" in name or name.startswith("."):
                continue
            if not isinstance(v, str):
                continue
            docs[name] = v
    system = raw.get("system")
    user = raw.get("user_template")
    return {
        "system": system if isinstance(system, str) and system.strip() else None,
        "user_template": user if isinstance(user, str) and user.strip() else None,
        "docs": docs,
    }


def _is_empty(ov: dict[str, Any]) -> bool:
    return not ov.get("system") and not ov.get("user_template") and not ov.get("docs")


def get(use_id: str) -> dict[str, Any]:
    try:
        path = _path(use_id)
    except ValueError:
        return dict(_EMPTY)
    if not path.is_file():
        return dict(_EMPTY)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(_EMPTY)
    return _normalize(raw)


def _write(use_id: str, ov: dict[str, Any]) -> dict[str, Any]:
    ov = _normalize(ov)
    path = _path(use_id)
    with _lock:
        if _is_empty(ov):
            try:
                path.unlink()
            except OSError:
                pass
            return dict(_EMPTY)
        _atomic_write(path, json.dumps(ov, indent=2, ensure_ascii=False) + "\n")
    return ov


def _clip(text: str) -> str:
    s = text if isinstance(text, str) else str(text or "")
    if len(s) > MAX_CHARS:
        raise ValueError(f"Prompt is too long (max {MAX_CHARS} characters)")
    return s


def save_field(
    use_id: str,
    *,
    field: str,
    text: str,
    name: str | None = None,
) -> dict[str, Any]:
    """Save one field. field is system | user_template | doc."""
    uid = _check_id(use_id)
    body = _clip(text)
    if not body.strip():
        return reset_field(uid, field=field, name=name)
    ov = get(uid)
    if field == "system":
        ov["system"] = body
    elif field in {"user", "user_template"}:
        ov["user_template"] = body
    elif field == "doc":
        doc = (name or "").strip()
        if not doc or "/" in doc or "\\" in doc:
            raise ValueError("Invalid doc name")
        docs = dict(ov.get("docs") or {})
        docs[doc] = body
        ov["docs"] = docs
    else:
        raise ValueError(f"Unknown prompt field: {field}")
    return _write(uid, ov)


def reset_field(
    use_id: str,
    *,
    field: str = "all",
    name: str | None = None,
) -> dict[str, Any]:
    uid = _check_id(use_id)
    ov = get(uid)
    if field == "all":
        return _write(uid, dict(_EMPTY))
    if field == "system":
        ov["system"] = None
    elif field in {"user", "user_template"}:
        ov["user_template"] = None
    elif field == "doc":
        doc = (name or "").strip()
        docs = dict(ov.get("docs") or {})
        docs.pop(doc, None)
        ov["docs"] = docs
    else:
        raise ValueError(f"Unknown prompt field: {field}")
    return _write(uid, ov)


def apply_system(use_id: str, default: str) -> str:
    custom = get(use_id).get("system")
    return custom if isinstance(custom, str) and custom.strip() else default


def apply_user_template(use_id: str, default: str) -> str:
    custom = get(use_id).get("user_template")
    return custom if isinstance(custom, str) and custom.strip() else default


def render_template(tmpl: str, mapping: dict[str, str]) -> str:
    """Replace {name} placeholders without touching braces inside inserted values."""
    items = sorted(mapping.items(), key=lambda kv: -len(kv[0]))
    out = tmpl
    sentinels: list[tuple[str, str]] = []
    for i, (key, val) in enumerate(items):
        token = f"\x00PH{i}\x00"
        sentinels.append((token, str(val)))
        out = out.replace("{" + key + "}", token)
    for token, val in sentinels:
        out = out.replace(token, val)
    return out


def annotate(use_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Attach override flags + live system/user/docs onto a catalog prompt payload."""
    out = dict(payload)
    editable = use_id in EDITABLE_IDS
    out["editable"] = editable
    ov = get(use_id) if editable else dict(_EMPTY)
    out["system_overridden"] = bool(ov.get("system"))
    out["user_overridden"] = bool(ov.get("user_template"))
    if ov.get("system"):
        out["system"] = ov["system"]
    if ov.get("user_template"):
        out["user_template"] = ov["user_template"]
    docs_ov = ov.get("docs") or {}
    docs = []
    for doc in out.get("docs") or []:
        if not isinstance(doc, dict):
            continue
        name = str(doc.get("name") or "")
        item = dict(doc)
        if name in docs_ov:
            item["text"] = docs_ov[name]
            item["overridden"] = True
            item["missing"] = not bool(str(docs_ov[name]).strip())
        else:
            item["overridden"] = False
        docs.append(item)
    out["docs"] = docs
    if out.get("system_overridden"):
        # Assembled system is a snapshot; file docs are not injected.
        pass
    elif docs_ov and out.get("kind") in {"chat", "vision"}:
        # Rebuild system from prefix+docs is the call site's job; catalog
        # already asks the call site for the live assembled system.
        pass
    return out
