"""Pact override requests.

Phone creates a scoped, time-limited request. The inbox and
approve/deny are bound to one reviewer passkey (see auth.py).

Kinds:
- app: unlock one package
- group: unlock every app in a group
- settings: unlock Pact settings (limits, windows, groups, server URL)

Hard rules:
- requested minutes must be 1..15
- approver may grant 1..240 minutes (custom time)
- comment is required
- one request per (device, kind, target) per local calendar day
- a pending request dies at local midnight if nobody decided
"""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from zoneinfo import ZoneInfo

from paths import data_root

TZ = ZoneInfo(
    os.environ.get("PACT_TZ")
    or os.environ.get("FOOD_TZ")
    or os.environ.get("FINANCE_TZ")
    or "Asia/Kolkata"
)

MAX_MINUTES = 15
MAX_APPROVE_MINUTES = 240
MIN_MINUTES = 1
MAX_COMMENT = 400
KEEP_DAYS = 60
KIND_APP = "app"
KIND_GROUP = "group"
KIND_SETTINGS = "settings"
KINDS = {KIND_APP, KIND_GROUP, KIND_SETTINGS}
SETTINGS_TARGET = "settings"
SETTINGS_PACKAGE = "pact.settings"
_PKG_RE = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
_TARGET_RE = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
_DEVICE_RE = re.compile(r"^[A-Za-z0-9._:-]{8,80}$")

_lock = threading.Lock()

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_DENIED = "denied"
STATUS_EXPIRED = "expired"


class PactError(Exception):
    def __init__(
        self,
        status: int,
        error: str,
        message: str,
        request: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.error = error
        self.message = message
        self.request = request

    def detail(self) -> dict[str, Any]:
        out: dict[str, Any] = {"error": self.error, "message": self.message}
        if self.request is not None:
            out["request"] = public_view(self.request)
        return out


def _dir() -> Path:
    d = data_root() / "pact"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path() -> Path:
    return _dir() / "requests.json"


def now_local() -> datetime:
    return datetime.now(TZ).replace(microsecond=0)


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(TZ).replace(microsecond=0).isoformat()


def _epoch_ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return int(dt.timestamp() * 1000)


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def _write_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".writing")
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        if tmp.is_file():
            try:
                tmp.unlink()
            except OSError:
                pass
        raise


def _load_unlocked() -> list[dict[str, Any]]:
    path = _path()
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(raw, dict):
        rows = raw.get("requests")
    else:
        rows = raw
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _save_unlocked(rows: list[dict[str, Any]]) -> None:
    cutoff = (now_local().date() - timedelta(days=KEEP_DAYS)).isoformat()
    kept = [row for row in rows if str(row.get("day") or "") >= cutoff]
    _write_atomic(_path(), {"requests": kept})


def _refresh_unlocked(rows: list[dict[str, Any]]) -> bool:
    """Expire stale pending rows. Returns True if anything changed."""
    today = now_local().date().isoformat()
    now = now_local()
    changed = False
    for row in rows:
        if row.get("status") != STATUS_PENDING:
            continue
        if str(row.get("day") or "") < today:
            row["status"] = STATUS_EXPIRED
            row["decided_at"] = _iso(now)
            row["decided_at_ms"] = _epoch_ms(now)
            changed = True
    return changed


def _find(rows: list[dict[str, Any]], request_id: str) -> dict[str, Any] | None:
    for row in rows:
        if row.get("id") == request_id:
            return row
    return None


def _kind_of(row: dict[str, Any]) -> str:
    kind = _clean_text(row.get("kind"), 20).lower()
    return kind if kind in KINDS else KIND_APP


def _target_of(row: dict[str, Any]) -> str:
    target = _clean_text(row.get("target_id"), 80)
    if target:
        return target
    kind = _kind_of(row)
    package_name = _clean_text(row.get("package_name"), 200)
    if kind == KIND_SETTINGS:
        return SETTINGS_TARGET
    if kind == KIND_GROUP:
        return package_name.removeprefix("group.")
    return package_name


def _already_today_message(kind: str) -> str:
    if kind == KIND_SETTINGS:
        return "Settings change already requested today."
    if kind == KIND_GROUP:
        return "This group already used its override request for today."
    return "This app already used its override request for today."


def public_view(row: dict[str, Any]) -> dict[str, Any]:
    now = now_local()
    status = str(row.get("status") or STATUS_PENDING)
    expires_at_ms = int(row.get("expires_at_ms") or 0)
    live = status == STATUS_APPROVED and expires_at_ms > _epoch_ms(now)
    kind = _kind_of(row)
    requested = int(row.get("requested_minutes") or row.get("minutes") or 0)
    return {
        "id": row.get("id"),
        "device_id": row.get("device_id"),
        "kind": kind,
        "target_id": _target_of(row),
        "package_name": row.get("package_name"),
        "app_label": row.get("app_label"),
        "minutes": int(row.get("minutes") or 0),
        "requested_minutes": requested,
        "comment": row.get("comment") or "",
        "status": status,
        "day": row.get("day"),
        "created_at": row.get("created_at"),
        "created_at_ms": int(row.get("created_at_ms") or 0),
        "decided_at": row.get("decided_at"),
        "decided_at_ms": int(row.get("decided_at_ms") or 0),
        "expires_at": row.get("expires_at"),
        "expires_at_ms": expires_at_ms,
        "live": live,
        "max_minutes": MAX_MINUTES,
        "max_approve_minutes": MAX_APPROVE_MINUTES,
    }


def bootstrap() -> dict[str, Any]:
    with _lock:
        rows = _load_unlocked()
        if _refresh_unlocked(rows):
            _save_unlocked(rows)
        views = [public_view(row) for row in rows]
    views.sort(key=lambda r: int(r.get("created_at_ms") or 0), reverse=True)
    pending = [r for r in views if r["status"] == STATUS_PENDING]
    recent = [r for r in views if r["status"] != STATUS_PENDING][:40]
    return {
        "ok": True,
        "max_minutes": MAX_MINUTES,
        "max_approve_minutes": MAX_APPROVE_MINUTES,
        "pending": pending,
        "recent": recent,
    }


def get_request(request_id: str) -> dict[str, Any]:
    request_id = _clean_text(request_id, 40)
    if not request_id:
        raise PactError(400, "invalid_id", "Missing request id.")
    with _lock:
        rows = _load_unlocked()
        if _refresh_unlocked(rows):
            _save_unlocked(rows)
        row = _find(rows, request_id)
        if row is None:
            raise PactError(404, "not_found", "That request is gone.")
        return public_view(row)


def _parse_minutes(raw: Any, lo: int, hi: int) -> int:
    try:
        minutes = int(raw)
    except (TypeError, ValueError):
        raise PactError(400, "invalid_minutes", "Minutes must be a number.") from None
    if minutes < lo or minutes > hi:
        raise PactError(
            400,
            "invalid_minutes",
            f"Minutes must be between {lo} and {hi}.",
        )
    return minutes


def create_request(body: dict[str, Any]) -> dict[str, Any]:
    device_id = _clean_text(body.get("device_id"), 80)
    kind = _clean_text(body.get("kind") or KIND_APP, 20).lower()
    package_name = _clean_text(body.get("package_name"), 200)
    target_id = _clean_text(body.get("target_id"), 80)
    app_label = _clean_text(body.get("app_label") or body.get("label"), 80)
    comment = _clean_text(body.get("comment"), MAX_COMMENT)
    minutes = _parse_minutes(body.get("minutes"), MIN_MINUTES, MAX_MINUTES)

    if not _DEVICE_RE.match(device_id):
        raise PactError(400, "invalid_device", "Missing or invalid device id.")
    if kind not in KINDS:
        raise PactError(400, "invalid_kind", "Kind must be app, group, or settings.")
    if not comment:
        raise PactError(400, "comment_required", "Write a short comment first.")

    if kind == KIND_SETTINGS:
        target_id = SETTINGS_TARGET
        package_name = SETTINGS_PACKAGE
        if not app_label:
            app_label = "Pact settings"
    elif kind == KIND_GROUP:
        if not target_id:
            target_id = package_name.removeprefix("group.")
        if not _TARGET_RE.match(target_id):
            raise PactError(400, "invalid_target", "Missing or invalid group id.")
        package_name = f"group.{target_id}"[:200]
        if not app_label:
            app_label = "Group"
    else:
        if not target_id:
            target_id = package_name
        if not _PKG_RE.match(package_name):
            raise PactError(400, "invalid_package", "Missing or invalid app package.")
        target_id = package_name
        if not app_label:
            app_label = package_name.rsplit(".", 1)[-1]

    now = now_local()
    today = now.date().isoformat()

    with _lock:
        rows = _load_unlocked()
        if _refresh_unlocked(rows):
            _save_unlocked(rows)

        for row in rows:
            if row.get("device_id") != device_id:
                continue
            if _kind_of(row) != kind:
                continue
            if _target_of(row) != target_id:
                continue
            if str(row.get("day") or "") != today:
                continue
            raise PactError(
                409,
                "already_requested_today",
                _already_today_message(kind),
                request=row,
            )

        row = {
            "id": uuid.uuid4().hex[:16],
            "device_id": device_id,
            "kind": kind,
            "target_id": target_id,
            "package_name": package_name,
            "app_label": app_label,
            "minutes": minutes,
            "requested_minutes": minutes,
            "comment": comment,
            "status": STATUS_PENDING,
            "day": today,
            "created_at": _iso(now),
            "created_at_ms": _epoch_ms(now),
            "decided_at": None,
            "decided_at_ms": 0,
            "expires_at": None,
            "expires_at_ms": 0,
        }
        rows.append(row)
        _save_unlocked(rows)
        return public_view(row)


def _decide(
    request_id: str,
    approved: bool,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request_id = _clean_text(request_id, 40)
    if not request_id:
        raise PactError(400, "invalid_id", "Missing request id.")
    payload = body or {}
    now = now_local()
    today = now.date().isoformat()

    with _lock:
        rows = _load_unlocked()
        if _refresh_unlocked(rows):
            _save_unlocked(rows)
        row = _find(rows, request_id)
        if row is None:
            raise PactError(404, "not_found", "That request is gone.")
        if row.get("status") != STATUS_PENDING:
            raise PactError(
                409,
                "not_pending",
                "This request was already decided.",
                request=row,
            )
        if str(row.get("day") or "") != today:
            row["status"] = STATUS_EXPIRED
            row["decided_at"] = _iso(now)
            row["decided_at_ms"] = _epoch_ms(now)
            _save_unlocked(rows)
            raise PactError(
                409,
                "expired",
                "This request expired at midnight.",
                request=row,
            )

        row["decided_at"] = _iso(now)
        row["decided_at_ms"] = _epoch_ms(now)
        if approved:
            raw = payload.get("minutes")
            if raw is None or raw == "":
                minutes = int(row.get("minutes") or 0)
            else:
                minutes = _parse_minutes(raw, MIN_MINUTES, MAX_APPROVE_MINUTES)
            if minutes < MIN_MINUTES:
                raise PactError(400, "invalid_minutes", "Minutes must be a number.")
            until = now + timedelta(minutes=minutes)
            row["status"] = STATUS_APPROVED
            row["minutes"] = minutes
            if not row.get("requested_minutes"):
                row["requested_minutes"] = minutes
            row["expires_at"] = _iso(until)
            row["expires_at_ms"] = _epoch_ms(until)
        else:
            row["status"] = STATUS_DENIED
        _save_unlocked(rows)
        return public_view(row)


def approve(request_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    return _decide(request_id, approved=True, body=body)


def deny(request_id: str) -> dict[str, Any]:
    return _decide(request_id, approved=False)
