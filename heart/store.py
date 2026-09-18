"""Heart bookmarks — one saved post, optional comment and custom tags."""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from paths import data_root

DATA_DIR = data_root() / "heart"
BOOKMARKS_PATH = DATA_DIR / "bookmarks.json"

TZ = ZoneInfo(
    os.environ.get("HEART_TZ")
    or os.environ.get("FOOD_TZ")
    or os.environ.get("FINANCE_TZ")
    or "Asia/Kolkata"
)

_lock = threading.Lock()
DATA_DIR.mkdir(parents=True, exist_ok=True)

_WS = re.compile(r"\s+")
MAX_COMMENT = 2000
MAX_TAG_LEN = 32
MAX_TAGS = 12


def now_iso() -> str:
    return datetime.now(TZ).replace(microsecond=0).isoformat()


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def _clean_post_id(value: Any) -> str:
    s = _clean_text(value, 80)
    if not s or s in {".", ".."} or "/" in s or "\\" in s:
        raise ValueError("Invalid post id")
    return s


def _clean_tags(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = re.split(r"[,;\n]+", raw)
    elif isinstance(raw, list):
        parts = raw
    else:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        tag = _WS.sub(" ", _clean_text(part, MAX_TAG_LEN)).strip(" #")
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(tag)
        if len(out) >= MAX_TAGS:
            break
    return out


def _normalize(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    try:
        post_id = _clean_post_id(raw.get("postId") or raw.get("post_id"))
    except ValueError:
        return None
    created = _clean_text(raw.get("createdAt") or raw.get("created_at"), 40)
    updated = _clean_text(raw.get("updatedAt") or raw.get("updated_at"), 40)
    return {
        "postId": post_id,
        "comment": _clean_text(raw.get("comment") or raw.get("note"), MAX_COMMENT),
        "tags": _clean_tags(raw.get("tags") or raw.get("customTags")),
        "createdAt": created or now_iso(),
        "updatedAt": updated or created or now_iso(),
    }


def _read() -> list[dict[str, Any]]:
    if not BOOKMARKS_PATH.is_file():
        return []
    try:
        data = json.loads(BOOKMARKS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    rows = data.get("bookmarks") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        item = _normalize(row)
        if not item or item["postId"] in seen:
            continue
        seen.add(item["postId"])
        out.append(item)
    out.sort(key=lambda b: b["updatedAt"], reverse=True)
    return out


def _write(items: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = BOOKMARKS_PATH.with_suffix(".json.writing")
    payload = json.dumps({"bookmarks": items}, ensure_ascii=False, indent=2) + "\n"
    try:
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, BOOKMARKS_PATH)
    except Exception:
        if tmp.is_file():
            try:
                tmp.unlink()
            except OSError:
                pass
        raise


def list_bookmarks() -> dict[str, Any]:
    with _lock:
        return {"bookmarks": _read()}


def upsert_bookmark(body: dict[str, Any] | None) -> dict[str, Any]:
    src = body if isinstance(body, dict) else {}
    post_id = _clean_post_id(src.get("postId") or src.get("post_id"))
    comment = _clean_text(src.get("comment") or src.get("note"), MAX_COMMENT)
    tags = _clean_tags(src.get("tags") or src.get("customTags"))
    now = now_iso()
    with _lock:
        items = _read()
        found = next((i for i, item in enumerate(items) if item["postId"] == post_id), None)
        if found is None:
            item = {
                "postId": post_id,
                "comment": comment,
                "tags": tags,
                "createdAt": now,
                "updatedAt": now,
            }
        else:
            item = {
                **items[found],
                "comment": comment,
                "tags": tags,
                "updatedAt": now,
            }
            items.pop(found)
        items.insert(0, item)
        _write(items)
        return item


def delete_bookmark(post_id: str) -> dict[str, Any]:
    post_id = _clean_post_id(post_id)
    with _lock:
        items = _read()
        keep = [item for item in items if item["postId"] != post_id]
        if len(keep) == len(items):
            raise KeyError(post_id)
        _write(keep)
        return {"ok": True, "postId": post_id}
