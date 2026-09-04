"""CFA study tracker — local JSON state + derived pace stats."""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "cfa"
STATE_PATH = DATA_DIR / "state.json"

TZ = ZoneInfo(os.environ.get("CFA_TZ", "Asia/Kolkata"))
EXAM_DATE = date(2026, 11, 17)
REVISION_DAYS = 20
CHAPTER_COUNT = 93
PROGRESS_STEPS = tuple(range(0, 101, 10))
PLAN_VERSION = 3

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_lock = threading.Lock()

DATA_DIR.mkdir(parents=True, exist_ok=True)


def _today() -> date:
    return datetime.now(TZ).date()


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or not _DATE_RE.match(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _clamp_progress(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 0
    n = max(0, min(100, n))
    return min(PROGRESS_STEPS, key=lambda s: abs(s - n))


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def _chapter_id(n: int) -> str:
    return f"c{n:03d}"


def _blank_chapter(n: int) -> dict[str, Any]:
    return {
        "id": _chapter_id(n),
        "n": n,
        "title": f"Chapter {n}",
        "progress": 0,
        "bookmarked": False,
        "notes": "",
        "date": None,
        "updatedOn": None,
        "completedOn": None,
    }


def _default_chapters() -> list[dict[str, Any]]:
    return [_blank_chapter(i) for i in range(1, CHAPTER_COUNT + 1)]


def _default_revision_start() -> date:
    return EXAM_DATE - timedelta(days=REVISION_DAYS)


def _parse_revision_start(src: Any) -> date:
    raw = src if isinstance(src, dict) else {}
    parsed = _parse_date(raw.get("revisionStart"))
    if parsed and parsed < EXAM_DATE:
        return parsed
    try:
        days = int(raw.get("revisionDays")) if raw.get("revisionDays") is not None else REVISION_DAYS
    except (TypeError, ValueError):
        days = REVISION_DAYS
    days = max(1, min(days, 400))
    return EXAM_DATE - timedelta(days=days)


def _default_state(today: date) -> dict[str, Any]:
    revision_start = _default_revision_start()
    return {
        "examDate": EXAM_DATE.isoformat(),
        "revisionStart": revision_start.isoformat(),
        "revisionDays": (EXAM_DATE - revision_start).days,
        "startedOn": today.isoformat(),
        "planVersion": PLAN_VERSION,
        "chapters": _default_chapters(),
        "offDays": [],
    }


def _normalize_chapter(raw: Any, fallback_n: int) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    try:
        n = int(raw.get("n") or fallback_n)
    except (TypeError, ValueError):
        n = fallback_n
    if n < 1 or n > CHAPTER_COUNT:
        return None
    cid = _chapter_id(n)
    progress = _clamp_progress(raw.get("progress"))
    updated = _parse_date(raw.get("updatedOn"))
    completed = _parse_date(raw.get("completedOn"))
    if progress >= 100:
        completed = completed or updated or _today()
    else:
        completed = None
    assigned = _parse_date(raw.get("date"))
    return {
        "id": cid,
        "n": n,
        "title": f"Chapter {n}",
        "progress": progress,
        "bookmarked": bool(raw.get("bookmarked")),
        "notes": _clean_text(raw.get("notes"), 4000),
        "date": _iso(assigned),
        "updatedOn": _iso(updated),
        "completedOn": _iso(completed),
    }


def _normalize_off(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    d = _parse_date(raw.get("date"))
    if not d:
        return None
    reason = _clean_text(raw.get("reason"), 200)
    return {"date": d.isoformat(), "reason": reason}


def _normalize_state(raw: Any, today: date) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    started = _parse_date(src.get("startedOn")) or today
    if started > today:
        started = today

    chapters_in = src.get("chapters") if isinstance(src.get("chapters"), list) else []
    by_n: dict[int, dict[str, Any]] = {}
    for i, item in enumerate(chapters_in, start=1):
        ch = _normalize_chapter(item, i)
        if not ch:
            continue
        by_n[ch["n"]] = ch
    chapters = [by_n.get(n) or _blank_chapter(n) for n in range(1, CHAPTER_COUNT + 1)]

    off_in = src.get("offDays")
    off_days: list[dict[str, str]] = []
    off_seen: set[str] = set()
    if isinstance(off_in, list):
        for item in off_in:
            off = _normalize_off(item)
            if not off or off["date"] in off_seen:
                continue
            off_seen.add(off["date"])
            off_days.append(off)
    off_days.sort(key=lambda x: x["date"])

    try:
        plan_version = int(src.get("planVersion") or 0)
    except (TypeError, ValueError):
        plan_version = 0

    revision_start = _parse_revision_start(src)
    return {
        "examDate": EXAM_DATE.isoformat(),
        "revisionStart": revision_start.isoformat(),
        "revisionDays": (EXAM_DATE - revision_start).days,
        "startedOn": started.isoformat(),
        "planVersion": plan_version,
        "chapters": chapters,
        "offDays": off_days,
    }


def _read_raw() -> dict[str, Any] | None:
    if not STATE_PATH.is_file():
        return None
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _write_atomic(state: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".json.writing")
    payload = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    try:
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, STATE_PATH)
    except Exception:
        if tmp.is_file():
            tmp.unlink()
        raise


def _daterange(start: date, end: date):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def compute_stats(state: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    today = today or _today()
    exam = EXAM_DATE
    revision_start = _parse_date(state.get("revisionStart")) or _default_revision_start()
    if revision_start >= exam:
        revision_start = exam - timedelta(days=1)
    prep_end = revision_start - timedelta(days=1)
    started = _parse_date(state.get("startedOn")) or today

    off_map = {
        item["date"]: item.get("reason") or ""
        for item in state.get("offDays") or []
        if item.get("date")
    }
    chapters = list(state.get("chapters") or [])

    if today < revision_start:
        phase = "prep"
    elif today < exam:
        phase = "revision"
    elif today == exam:
        phase = "exam"
    else:
        phase = "after"

    days_to_exam = (exam - today).days
    days_to_revision = (revision_start - today).days
    prep_days_left = 0
    if today <= prep_end:
        for d in _daterange(today, prep_end):
            if d.isoformat() not in off_map:
                prep_days_left += 1

    revision_days_left = 0
    if today < exam:
        rev_from = max(today, revision_start)
        for d in _daterange(rev_from, exam - timedelta(days=1)):
            if d.isoformat() not in off_map:
                revision_days_left += 1

    remaining_units = 0.0
    done = 0
    bookmarked = 0
    unscheduled = 0
    overdue = 0
    for ch in chapters:
        progress = int(ch.get("progress") or 0)
        remaining_units += max(0, 100 - progress) / 100.0
        if progress >= 100:
            done += 1
        if ch.get("bookmarked"):
            bookmarked += 1
        assigned = ch.get("date")
        if progress < 100 and not assigned:
            unscheduled += 1
        if progress < 100 and assigned and assigned < today.isoformat():
            overdue += 1

    total = len(chapters)
    left = total - done
    denom = max(prep_days_left, 0)
    if phase == "prep" and denom > 0:
        pace = round(remaining_units / denom, 2)
    elif remaining_units > 0 and phase in {"revision", "exam", "after"}:
        pace = round(remaining_units, 2)
    else:
        pace = 0.0

    today_iso = today.isoformat()
    today_off = None
    if today_iso in off_map:
        today_off = {"date": today_iso, "reason": off_map[today_iso]}

    wasted = 0
    walk_end = min(today - timedelta(days=1), prep_end)
    if started <= walk_end:
        touched_by_day: set[str] = set()
        for ch in chapters:
            if ch.get("updatedOn"):
                touched_by_day.add(ch["updatedOn"])
            if ch.get("completedOn"):
                touched_by_day.add(ch["completedOn"])
        for d in _daterange(started, walk_end):
            iso = d.isoformat()
            if iso in off_map:
                continue
            if iso not in touched_by_day:
                wasted += 1

    streak = 0
    cursor = today
    while cursor >= started:
        iso = cursor.isoformat()
        if iso in off_map:
            cursor -= timedelta(days=1)
            continue
        hit = False
        for ch in chapters:
            if ch.get("updatedOn") == iso or ch.get("completedOn") == iso:
                hit = True
                break
        if not hit:
            if cursor == today:
                cursor -= timedelta(days=1)
                continue
            break
        streak += 1
        cursor -= timedelta(days=1)

    return {
        "today": today.isoformat(),
        "examDate": exam.isoformat(),
        "revisionStart": revision_start.isoformat(),
        "prepEnd": prep_end.isoformat(),
        "phase": phase,
        "daysToExam": days_to_exam,
        "daysToRevision": days_to_revision,
        "revisionDays": (exam - revision_start).days,
        "prepDaysLeft": prep_days_left,
        "revisionDaysLeft": revision_days_left,
        "total": total,
        "done": done,
        "left": left,
        "remainingUnits": round(remaining_units, 2),
        "pace": pace,
        "bookmarked": bookmarked,
        "unscheduled": unscheduled,
        "overdue": overdue,
        "wastedDays": wasted,
        "streak": streak,
        "todayOff": today_off,
    }


def _study_days(today: date, prep_end: date, off: set[str]) -> list[date]:
    if today > prep_end:
        return []
    return [d for d in _daterange(today, prep_end) if d.isoformat() not in off]


def compute_plan(state: dict[str, Any], today: date | None = None) -> list[dict[str, Any]]:
    """Spread leftover chapter work across prep days up to the day before revision."""
    today = today or _today()
    exam = EXAM_DATE
    revision_start = _parse_date(state.get("revisionStart")) or _default_revision_start()
    if revision_start >= exam:
        revision_start = exam - timedelta(days=1)
    prep_end = revision_start - timedelta(days=1)
    off = {item["date"] for item in state.get("offDays") or [] if item.get("date")}

    leftover: list[list[Any]] = []
    for ch in state.get("chapters") or []:
        progress = int(ch.get("progress") or 0)
        tenths = max(0, (100 - progress) // 10)
        if tenths <= 0:
            continue
        leftover.append([ch, progress, tenths])

    study = _study_days(today, prep_end, off)
    by_day: dict[str, list[dict[str, Any]]] = {d.isoformat(): [] for d in study}

    if leftover and study:
        total_tenths = sum(item[2] for item in leftover)
        # Enough days: one remaining chapter per day. Too few: pack evenly.
        if total_tenths <= 10 * len(study):
            for day, item in zip(study, leftover):
                ch, start, tenths = item
                by_day[day.isoformat()].append(
                    {
                        "id": ch["id"],
                        "n": ch["n"],
                        "percent": tenths * 10,
                        "from": start,
                        "to": start + tenths * 10,
                    }
                )
        else:
            n_days = len(study)
            base, extra = divmod(total_tenths, n_days)
            quotas = [base + (1 if i < extra else 0) for i in range(n_days)]
            qi = 0
            for day, quota in zip(study, quotas):
                need = quota
                items: list[dict[str, Any]] = []
                while need > 0 and qi < len(leftover):
                    ch, start, left = leftover[qi]
                    take = min(left, need)
                    items.append(
                        {
                            "id": ch["id"],
                            "n": ch["n"],
                            "percent": take * 10,
                            "from": start,
                            "to": start + take * 10,
                        }
                    )
                    leftover[qi][1] = start + take * 10
                    leftover[qi][2] = left - take
                    need -= take
                    if leftover[qi][2] <= 0:
                        qi += 1
                by_day[day.isoformat()] = items

    out: list[dict[str, Any]] = []
    if today > exam:
        return out
    for d in _daterange(today, exam):
        iso = d.isoformat()
        if iso == exam.isoformat():
            kind = "exam"
        elif iso in off:
            kind = "off"
        elif d >= revision_start:
            kind = "revision"
        else:
            kind = "prep"
        out.append({"date": iso, "kind": kind, "items": by_day.get(iso, [])})
    return out


def _with_derived(state: dict[str, Any], today: date) -> dict[str, Any]:
    out = dict(state)
    out["stats"] = compute_stats(state, today)
    out["plan"] = compute_plan(state, today)
    return out


def get_state() -> dict[str, Any]:
    today = _today()
    with _lock:
        raw = _read_raw()
        if raw is None:
            state = _default_state(today)
            _write_atomic(state)
        else:
            state = _normalize_state(raw, today)
            raw_ns: set[int] = set()
            for item in raw.get("chapters") or []:
                if not isinstance(item, dict):
                    continue
                try:
                    raw_ns.add(int(item.get("n")))
                except (TypeError, ValueError):
                    continue
            stale = int(state.get("planVersion") or 0) < PLAN_VERSION
            if stale:
                state["planVersion"] = PLAN_VERSION
            if stale or raw_ns != set(range(1, CHAPTER_COUNT + 1)):
                _write_atomic(state)
    return _with_derived(state, today)


def save_state(payload: Any) -> dict[str, Any]:
    today = _today()
    incoming = payload if isinstance(payload, dict) else {}
    with _lock:
        current = _normalize_state(_read_raw() or _default_state(today), today)
        merged = {
            "startedOn": current["startedOn"],
            "revisionStart": current.get("revisionStart"),
            "revisionDays": current.get("revisionDays"),
            "planVersion": current.get("planVersion") or PLAN_VERSION,
            "chapters": incoming.get("chapters", current["chapters"]),
            "offDays": incoming.get("offDays", current["offDays"]),
        }
        if incoming.get("startedOn"):
            merged["startedOn"] = incoming["startedOn"]
        if incoming.get("revisionStart"):
            merged["revisionStart"] = incoming["revisionStart"]
        if incoming.get("revisionDays") is not None:
            merged["revisionDays"] = incoming["revisionDays"]
        if incoming.get("planVersion") is not None:
            merged["planVersion"] = incoming["planVersion"]
        state = _normalize_state(merged, today)
        if not _parse_date(state.get("startedOn")):
            state["startedOn"] = current["startedOn"]
        state["planVersion"] = PLAN_VERSION
        _write_atomic(state)
    return _with_derived(state, today)
