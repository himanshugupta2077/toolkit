"""CFA study tracker — readings, page pace, local JSON state."""

from __future__ import annotations

import json
import math
import os
import re
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from paths import data_root

TZ = ZoneInfo(os.environ.get("CFA_TZ", "Asia/Kolkata"))
EXAM_DATE = date(2026, 11, 17)
REVISION_DAYS = 20
READING_COUNT = 93
SEED_COMPLETE_THROUGH = 15
PLAN_VERSION = 5
PAGES_MIN = 1
PAGES_MAX = 200
DEFAULT_PAGES_PER_HOUR = 5.0
DEFAULT_WEEKDAY_HOURS = 3.0
DEFAULT_WEEKEND_HOURS = 6.0

# Index 0 unused; READING_PAGES[n] is default pages in reading n.
READING_PAGES: tuple[int, ...] = (
    0,
    14, 14, 15, 5, 8, 5, 7, 18, 4, 18,
    4, 19, 7, 8, 9, 7, 7, 9, 6, 5,
    6, 7, 8, 11, 12, 4, 9, 30, 12, 24,
    8, 16, 13, 18, 18, 13, 26, 8, 22, 14,
    9, 10, 7, 13, 9, 24, 5, 9, 6, 8,
    4, 9, 9, 4, 9, 8, 5, 7, 7, 9,
    3, 7, 5, 6, 9, 7, 9, 6, 7, 5,
    3, 3, 8, 5, 7, 6, 9, 5, 7, 4,
    6, 10, 14, 21, 9, 9, 13, 8, 6, 7,
    27, 4, 9,
)

BOOKS: tuple[dict[str, Any], ...] = (
    {"n": 1, "from": 1, "to": 26, "title": "Book 1"},
    {"n": 2, "from": 27, "to": 46, "title": "Book 2"},
    {"n": 3, "from": 47, "to": 75, "title": "Book 3"},
    {"n": 4, "from": 76, "to": 93, "title": "Book 4"},
)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_lock = threading.Lock()


def _state_path() -> Path:
    d = data_root() / "cfa"
    d.mkdir(parents=True, exist_ok=True)
    return d / "state.json"


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


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def _clamp_num(value: Any, default: float, lo: float, hi: float) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    if n != n or n in {float("inf"), float("-inf")}:
        return default
    return max(lo, min(hi, n))


def _hours(value: Any, default: float) -> float:
    n = _clamp_num(value, default, 0.0, 16.0)
    return round(n * 2) / 2


def _pages_per_hour(value: Any) -> float:
    n = _clamp_num(value, DEFAULT_PAGES_PER_HOUR, 0.5, 40.0)
    return round(n * 2) / 2


def _reading_id(n: int) -> str:
    return f"r{n:03d}"


def _book_for(n: int) -> int:
    for book in BOOKS:
        if book["from"] <= n <= book["to"]:
            return int(book["n"])
    return 4


def _pages_for(n: int) -> int:
    if 1 <= n <= READING_COUNT:
        return int(READING_PAGES[n])
    return PAGES_MIN


def _clamp_pages_count(value: Any, default: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(PAGES_MIN, min(PAGES_MAX, n))


def _clamp_page(value: Any, pages: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(pages, n))


def _page_from_progress(progress: Any, pages: int) -> int:
    try:
        pct = int(progress)
    except (TypeError, ValueError):
        return 0
    pct = max(0, min(100, pct))
    if pages <= 0:
        return 0
    if pct >= 100:
        return pages
    return int(round(pages * pct / 100.0))


def _blank_reading(n: int, today: date, *, complete_through: int = 0) -> dict[str, Any]:
    pages = _pages_for(n)
    done = n <= complete_through
    page = pages if done else 0
    return {
        "id": _reading_id(n),
        "n": n,
        "title": f"Reading {n}",
        "book": _book_for(n),
        "pages": pages,
        "page": page,
        "progress": 100 if done and pages else 0,
        "bookmarked": False,
        "notes": "",
        "date": None,
        "updatedOn": _iso(today) if done else None,
        "completedOn": _iso(today) if done else None,
    }


def _default_revision_start() -> date:
    return EXAM_DATE - timedelta(days=REVISION_DAYS)


def _revision_end() -> date:
    return EXAM_DATE - timedelta(days=1)


def _parse_revision_start(src: Any) -> date:
    raw = src if isinstance(src, dict) else {}
    parsed = _parse_date(raw.get("revisionStart"))
    end = _revision_end()
    if parsed and parsed <= end:
        return parsed
    try:
        days = int(raw.get("revisionDays")) if raw.get("revisionDays") is not None else REVISION_DAYS
    except (TypeError, ValueError):
        days = REVISION_DAYS
    days = max(1, min(days, 400))
    start = EXAM_DATE - timedelta(days=days)
    if start > end:
        start = end
    return start


def _default_state(today: date) -> dict[str, Any]:
    revision_start = _default_revision_start()
    return {
        "examDate": EXAM_DATE.isoformat(),
        "revisionStart": revision_start.isoformat(),
        "revisionEnd": _revision_end().isoformat(),
        "revisionDays": (_revision_end() - revision_start).days + 1,
        "startedOn": today.isoformat(),
        "planVersion": PLAN_VERSION,
        "pagesPerHour": DEFAULT_PAGES_PER_HOUR,
        "weekdayHours": DEFAULT_WEEKDAY_HOURS,
        "weekendHours": DEFAULT_WEEKEND_HOURS,
        "readings": [
            _blank_reading(i, today, complete_through=SEED_COMPLETE_THROUGH)
            for i in range(1, READING_COUNT + 1)
        ],
        "offDays": [],
    }


def _incoming_readings(src: dict[str, Any]) -> list[Any]:
    if isinstance(src.get("readings"), list):
        return src["readings"]
    if isinstance(src.get("chapters"), list):
        return src["chapters"]
    return []


def _normalize_reading(
    raw: Any,
    fallback_n: int,
    today: date,
    *,
    complete_through: int,
    use_stored_pages: bool,
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    try:
        n = int(raw.get("n") or fallback_n)
    except (TypeError, ValueError):
        n = fallback_n
    if n < 1 or n > READING_COUNT:
        return None
    default_pages = _pages_for(n)
    if use_stored_pages and raw.get("pages") is not None:
        pages = _clamp_pages_count(raw.get("pages"), default_pages)
    else:
        pages = default_pages
    if raw.get("page") is not None:
        page = _clamp_page(raw.get("page"), pages)
    else:
        page = _page_from_progress(raw.get("progress"), pages)
    if n <= complete_through:
        page = pages
    updated = _parse_date(raw.get("updatedOn"))
    completed = _parse_date(raw.get("completedOn"))
    if page >= pages and pages > 0:
        completed = completed or updated or today
        if n <= complete_through and not updated:
            updated = completed
    else:
        completed = None
    assigned = _parse_date(raw.get("date"))
    progress = 0 if pages <= 0 else int(round(100 * page / pages))
    return {
        "id": _reading_id(n),
        "n": n,
        "title": f"Reading {n}",
        "book": _book_for(n),
        "pages": pages,
        "page": page,
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

    try:
        plan_version = int(src.get("planVersion") or 0)
    except (TypeError, ValueError):
        plan_version = 0
    stale = plan_version < PLAN_VERSION
    complete_through = SEED_COMPLETE_THROUGH if plan_version < 4 else 0
    use_stored_pages = plan_version >= PLAN_VERSION

    by_n: dict[int, dict[str, Any]] = {}
    for i, item in enumerate(_incoming_readings(src), start=1):
        rd = _normalize_reading(
            item,
            i,
            today,
            complete_through=complete_through,
            use_stored_pages=use_stored_pages,
        )
        if not rd:
            continue
        by_n[rd["n"]] = rd
    readings = [
        by_n.get(n) or _blank_reading(n, today, complete_through=complete_through)
        for n in range(1, READING_COUNT + 1)
    ]

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

    revision_start = _parse_revision_start(src)
    rev_end = _revision_end()
    if revision_start > rev_end:
        revision_start = rev_end

    return {
        "examDate": EXAM_DATE.isoformat(),
        "revisionStart": revision_start.isoformat(),
        "revisionEnd": rev_end.isoformat(),
        "revisionDays": (rev_end - revision_start).days + 1,
        "startedOn": started.isoformat(),
        "planVersion": PLAN_VERSION,
        "pagesPerHour": _pages_per_hour(src.get("pagesPerHour")),
        "weekdayHours": _hours(src.get("weekdayHours"), DEFAULT_WEEKDAY_HOURS),
        "weekendHours": _hours(src.get("weekendHours"), DEFAULT_WEEKEND_HOURS),
        "readings": readings,
        "offDays": off_days,
    }


def _read_raw() -> dict[str, Any] | None:
    path = _state_path()
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _write_atomic(state: dict[str, Any]) -> None:
    path = _state_path()
    tmp = path.with_suffix(".json.writing")
    persist = {
        "examDate": state["examDate"],
        "revisionStart": state["revisionStart"],
        "revisionDays": state["revisionDays"],
        "startedOn": state["startedOn"],
        "planVersion": state["planVersion"],
        "pagesPerHour": state["pagesPerHour"],
        "weekdayHours": state["weekdayHours"],
        "weekendHours": state["weekendHours"],
        "readings": [
            {
                "id": r["id"],
                "n": r["n"],
                "title": r["title"],
                "book": r["book"],
                "pages": r["pages"],
                "page": r["page"],
                "bookmarked": r["bookmarked"],
                "notes": r["notes"],
                "date": r["date"],
                "updatedOn": r["updatedOn"],
                "completedOn": r["completedOn"],
            }
            for r in state["readings"]
        ],
        "offDays": state["offDays"],
    }
    payload = json.dumps(persist, ensure_ascii=False, indent=2) + "\n"
    try:
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        if tmp.is_file():
            tmp.unlink()
        raise


def _daterange(start: date, end: date):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def _is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def _round_pages(value: float) -> int:
    if value <= 0:
        return 0
    return int(value + 0.5)


def _ceil_half(value: float) -> float:
    if value <= 0:
        return 0.5
    return math.ceil(value * 2 - 1e-9) / 2


def _day_hours(d: date, state: dict[str, Any]) -> float:
    if _is_weekend(d):
        return float(state.get("weekendHours") or 0)
    return float(state.get("weekdayHours") or 0)


def _day_capacity(d: date, state: dict[str, Any]) -> int:
    pph = float(state.get("pagesPerHour") or DEFAULT_PAGES_PER_HOUR)
    return _round_pages(pph * _day_hours(d, state))


def _prep_bounds(state: dict[str, Any]) -> tuple[date, date]:
    rev_end = _revision_end()
    revision_start = _parse_date(state.get("revisionStart")) or _default_revision_start()
    if revision_start > rev_end:
        revision_start = rev_end
    return revision_start, revision_start - timedelta(days=1)


def _off_map(state: dict[str, Any]) -> dict[str, str]:
    return {
        item["date"]: item.get("reason") or ""
        for item in state.get("offDays") or []
        if item.get("date")
    }


def _study_days(today: date, prep_end: date, off: set[str]) -> list[date]:
    if today > prep_end:
        return []
    return [d for d in _daterange(today, prep_end) if d.isoformat() not in off]


def _remaining_pages(readings: list[dict[str, Any]]) -> int:
    total = 0
    for r in readings:
        pages = int(r.get("pages") or 0)
        page = int(r.get("page") or 0)
        total += max(0, pages - page)
    return total


def compute_pace_outlook(state: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """Can this pace finish remaining pages before revision, and on which day?"""
    today = today or _today()
    revision_start, prep_end = _prep_bounds(state)
    off = {item["date"] for item in state.get("offDays") or [] if item.get("date")}
    study = _study_days(today, prep_end, off)
    remaining = _remaining_pages(list(state.get("readings") or []))
    pph = float(state.get("pagesPerHour") or DEFAULT_PAGES_PER_HOUR)
    weekday_hours = float(state.get("weekdayHours") or 0)
    weekend_hours = float(state.get("weekendHours") or 0)
    weekday_pages = _round_pages(pph * weekday_hours)
    weekend_pages = _round_pages(pph * weekend_hours)

    hours_avail = 0.0
    pages_avail = 0
    finish_on: str | None = None
    left = remaining
    for d in study:
        hours = _day_hours(d, state)
        cap = _day_capacity(d, state)
        hours_avail += hours
        pages_avail += cap
        if left <= 0 or cap <= 0:
            continue
        left -= min(left, cap)
        if left <= 0:
            finish_on = d.isoformat()

    unscheduled = max(0, left)
    feasible = remaining == 0 or unscheduled == 0
    hours_needed = round(remaining / pph, 2) if pph else 0.0

    suggest_pph: float | None = None
    if remaining > 0 and not feasible and hours_avail > 0:
        trial = dict(state)
        start = _ceil_half(remaining / hours_avail)
        step = max(0.5, start)
        while step <= 40.0:
            trial["pagesPerHour"] = step
            trial_left = remaining
            ok = True
            for d in study:
                cap = _day_capacity(d, trial)
                if cap <= 0:
                    continue
                trial_left -= min(trial_left, cap)
                if trial_left <= 0:
                    break
            if trial_left <= 0:
                suggest_pph = step
                break
            step = round(step + 0.5, 1)

    return {
        "remainingPages": remaining,
        "pagesPerHour": pph,
        "weekdayHours": weekday_hours,
        "weekendHours": weekend_hours,
        "weekdayPages": weekday_pages,
        "weekendPages": weekend_pages,
        "hoursAvailable": round(hours_avail, 2),
        "hoursNeeded": hours_needed,
        "pagesAvailable": pages_avail,
        "unscheduledPages": unscheduled,
        "finishOn": finish_on,
        "feasible": feasible,
        "suggestPagesPerHour": suggest_pph,
        "revisionStart": revision_start.isoformat(),
        "prepEnd": prep_end.isoformat(),
        "prepDaysLeft": len(study),
    }


def _book_summaries(readings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_n = {int(r["n"]): r for r in readings}
    out: list[dict[str, Any]] = []
    for book in BOOKS:
        pages = 0
        done = 0
        left = 0
        remaining = 0
        for n in range(int(book["from"]), int(book["to"]) + 1):
            r = by_n.get(n)
            if not r:
                continue
            p = int(r.get("pages") or 0)
            cur = int(r.get("page") or 0)
            pages += p
            remaining += max(0, p - cur)
            if p > 0 and cur >= p:
                done += 1
            else:
                left += 1
        out.append(
            {
                "n": book["n"],
                "from": book["from"],
                "to": book["to"],
                "title": book["title"],
                "pages": pages,
                "done": done,
                "left": left,
                "remainingPages": remaining,
            }
        )
    return out


def compute_stats(state: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    today = today or _today()
    exam = EXAM_DATE
    rev_end = _revision_end()
    revision_start = _parse_date(state.get("revisionStart")) or _default_revision_start()
    if revision_start > rev_end:
        revision_start = rev_end
    prep_end = revision_start - timedelta(days=1)
    started = _parse_date(state.get("startedOn")) or today

    off_map = _off_map(state)
    readings = list(state.get("readings") or [])

    if today < revision_start:
        phase = "prep"
    elif today <= rev_end:
        phase = "revision"
    elif today == exam:
        phase = "exam"
    else:
        phase = "after"

    days_to_exam = (exam - today).days
    days_to_revision = (revision_start - today).days
    prep_days_left = 0
    prep_hours_left = 0.0
    if today <= prep_end:
        for d in _daterange(today, prep_end):
            if d.isoformat() in off_map:
                continue
            prep_days_left += 1
            prep_hours_left += _day_hours(d, state)

    revision_days_left = 0
    if today <= rev_end:
        rev_from = max(today, revision_start)
        for d in _daterange(rev_from, rev_end):
            if d.isoformat() not in off_map:
                revision_days_left += 1

    outlook = compute_pace_outlook(state, today)
    remaining_pages = outlook["remainingPages"]
    pph = outlook["pagesPerHour"]
    hours_needed = outlook["hoursNeeded"]
    done = 0
    bookmarked = 0
    unscheduled = 0
    overdue = 0
    for r in readings:
        pages = int(r.get("pages") or 0)
        page = int(r.get("page") or 0)
        if pages > 0 and page >= pages:
            done += 1
        if r.get("bookmarked"):
            bookmarked += 1
        assigned = r.get("date")
        if page < pages and not assigned:
            unscheduled += 1
        if page < pages and assigned and assigned < today.isoformat():
            overdue += 1

    total = len(readings)
    left = total - done
    denom = max(prep_days_left, 0)
    if phase == "prep" and denom > 0:
        pace = round(remaining_pages / denom, 2)
    elif remaining_pages > 0 and phase in {"revision", "exam", "after"}:
        pace = round(remaining_pages, 2)
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
        for r in readings:
            if r.get("updatedOn"):
                touched_by_day.add(r["updatedOn"])
            if r.get("completedOn"):
                touched_by_day.add(r["completedOn"])
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
        for r in readings:
            if r.get("updatedOn") == iso or r.get("completedOn") == iso:
                hit = True
                break
        if not hit:
            if cursor == today:
                cursor -= timedelta(days=1)
                continue
            break
        streak += 1
        cursor -= timedelta(days=1)

    today_hours = 0.0 if today_iso in off_map else _day_hours(today, state)
    today_capacity = 0 if today_iso in off_map else _day_capacity(today, state)

    return {
        "today": today.isoformat(),
        "examDate": exam.isoformat(),
        "revisionStart": revision_start.isoformat(),
        "revisionEnd": rev_end.isoformat(),
        "prepEnd": prep_end.isoformat(),
        "phase": phase,
        "daysToExam": days_to_exam,
        "daysToRevision": days_to_revision,
        "revisionDays": (rev_end - revision_start).days + 1,
        "prepDaysLeft": prep_days_left,
        "prepHoursLeft": round(prep_hours_left, 2),
        "hoursNeeded": hours_needed,
        "hoursAvailable": outlook["hoursAvailable"],
        "pagesAvailable": outlook["pagesAvailable"],
        "unscheduledPages": outlook["unscheduledPages"],
        "finishOn": outlook["finishOn"],
        "feasible": outlook["feasible"],
        "suggestPagesPerHour": outlook["suggestPagesPerHour"],
        "weekdayPages": outlook["weekdayPages"],
        "weekendPages": outlook["weekendPages"],
        "revisionDaysLeft": revision_days_left,
        "total": total,
        "done": done,
        "left": left,
        "remainingPages": remaining_pages,
        "remainingUnits": remaining_pages,
        "pace": pace,
        "pagesPerHour": pph,
        "weekdayHours": float(state.get("weekdayHours") or 0),
        "weekendHours": float(state.get("weekendHours") or 0),
        "todayHours": today_hours,
        "todayCapacity": today_capacity,
        "overloaded": not outlook["feasible"],
        "bookmarked": bookmarked,
        "unscheduled": unscheduled,
        "overdue": overdue,
        "wastedDays": wasted,
        "streak": streak,
        "todayOff": today_off,
    }


def compute_plan(state: dict[str, Any], today: date | None = None) -> list[dict[str, Any]]:
    """Fill each remaining prep day up to that day's page capacity (weekday vs weekend)."""
    today = today or _today()
    exam = EXAM_DATE
    rev_end = _revision_end()
    revision_start = _parse_date(state.get("revisionStart")) or _default_revision_start()
    if revision_start > rev_end:
        revision_start = rev_end
    prep_end = revision_start - timedelta(days=1)
    off = {item["date"] for item in state.get("offDays") or [] if item.get("date")}

    leftover: list[dict[str, Any]] = []
    for r in state.get("readings") or []:
        pages = int(r.get("pages") or 0)
        page = int(r.get("page") or 0)
        left = max(0, pages - page)
        if left <= 0:
            continue
        leftover.append({"r": r, "from": page + 1, "left": left})

    study = _study_days(today, prep_end, off)
    by_day: dict[str, list[dict[str, Any]]] = {d.isoformat(): [] for d in study}
    used_pages: dict[str, int] = {d.isoformat(): 0 for d in study}

    li = 0
    for d in study:
        cap = _day_capacity(d, state)
        if cap <= 0:
            continue
        need = cap
        while need > 0 and li < len(leftover):
            item = leftover[li]
            take = min(item["left"], need)
            start = int(item["from"])
            end = start + take - 1
            r = item["r"]
            by_day[d.isoformat()].append(
                {
                    "id": r["id"],
                    "n": r["n"],
                    "pagesFrom": start,
                    "pagesTo": end,
                    "pages": take,
                }
            )
            item["from"] = end + 1
            item["left"] -= take
            need -= take
            used_pages[d.isoformat()] += take
            if item["left"] <= 0:
                li += 1

    out: list[dict[str, Any]] = []
    if today > exam:
        return out
    pph = float(state.get("pagesPerHour") or DEFAULT_PAGES_PER_HOUR)
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
        hours = 0.0 if kind != "prep" else _day_hours(d, state)
        cap = 0 if kind != "prep" else _day_capacity(d, state)
        pages = used_pages.get(iso, 0)
        hours_used = round(pages / pph, 2) if pph and pages else 0.0
        out.append(
            {
                "date": iso,
                "kind": kind,
                "items": by_day.get(iso, []),
                "pages": pages,
                "capacity": cap,
                "hours": hours,
                "hoursUsed": hours_used,
            }
        )
    return out


def _with_derived(state: dict[str, Any], today: date) -> dict[str, Any]:
    out = dict(state)
    out["stats"] = compute_stats(state, today)
    out["plan"] = compute_plan(state, today)
    out["books"] = _book_summaries(list(state.get("readings") or []))
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
            for item in _incoming_readings(raw):
                if not isinstance(item, dict):
                    continue
                try:
                    raw_ns.add(int(item.get("n")))
                except (TypeError, ValueError):
                    continue
            try:
                stale = int(raw.get("planVersion") or 0) < PLAN_VERSION
            except (TypeError, ValueError):
                stale = True
            if stale or raw_ns != set(range(1, READING_COUNT + 1)) or "readings" not in raw:
                _write_atomic(state)
    return _with_derived(state, today)


def preview_pace(payload: Any, today: date | None = None) -> dict[str, Any]:
    today = today or _today()
    incoming = payload if isinstance(payload, dict) else {}
    with _lock:
        current = _normalize_state(_read_raw() or _default_state(today), today)
    trial = dict(current)
    if incoming.get("pagesPerHour") is not None:
        trial["pagesPerHour"] = _pages_per_hour(incoming.get("pagesPerHour"))
    if incoming.get("weekdayHours") is not None:
        trial["weekdayHours"] = _hours(incoming.get("weekdayHours"), DEFAULT_WEEKDAY_HOURS)
    if incoming.get("weekendHours") is not None:
        trial["weekendHours"] = _hours(incoming.get("weekendHours"), DEFAULT_WEEKEND_HOURS)
    return compute_pace_outlook(trial, today)


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
            "pagesPerHour": current.get("pagesPerHour"),
            "weekdayHours": current.get("weekdayHours"),
            "weekendHours": current.get("weekendHours"),
            "readings": incoming.get("readings", incoming.get("chapters", current["readings"])),
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
        if incoming.get("pagesPerHour") is not None:
            merged["pagesPerHour"] = incoming["pagesPerHour"]
        if incoming.get("weekdayHours") is not None:
            merged["weekdayHours"] = incoming["weekdayHours"]
        if incoming.get("weekendHours") is not None:
            merged["weekendHours"] = incoming["weekendHours"]
        state = _normalize_state(merged, today)
        if not _parse_date(state.get("startedOn")):
            state["startedOn"] = current["startedOn"]
        state["planVersion"] = PLAN_VERSION
        _write_atomic(state)
    return _with_derived(state, today)
