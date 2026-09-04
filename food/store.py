"""Food catalog + eat log + week plan. Empty until the user logs something."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "food"
ITEMS_PATH = DATA_DIR / "items.json"
LOGS_PATH = DATA_DIR / "logs.json"
PLANS_PATH = DATA_DIR / "plans.json"

TZ = ZoneInfo(os.environ.get("FOOD_TZ") or os.environ.get("FINANCE_TZ") or "Asia/Kolkata")

MACROS = ("carbs", "protein", "fiber", "fat")
LEVELS = ("none", "low", "medium", "high")
LEVEL_N = {"none": 0, "low": 1, "medium": 2, "high": 3}
SLOTS = ("breakfast", "lunch", "snack", "dinner", "other")

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_CONST_SPLIT = re.compile(
    r"\s*(?:,|;|\n|\+|\&|(?:\s+and\s+)|(?:\s+with\s+))\s*",
    re.IGNORECASE,
)
_LEAD_BITS = re.compile(
    r"^(?:a\s+)?(?:bit of|some|little|a little|lots of|lot of)\s+",
    re.IGNORECASE,
)

_lock = threading.Lock()
DATA_DIR.mkdir(parents=True, exist_ok=True)


def now_local() -> datetime:
    return datetime.now(TZ)


def today() -> date:
    return now_local().date()


def _iso_dt(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(TZ).replace(microsecond=0).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def name_key(value: Any) -> str:
    s = _clean_text(value, 80).lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def split_constitutes(value: Any) -> list[str]:
    """Turn 'potato and carrot, paneer' into unique ingredient names."""
    text = _clean_text(value, 400)
    if not text:
        return []
    parts = _CONST_SPLIT.split(text)
    out: list[str] = []
    seen: set[str] = set()
    for raw in parts:
        piece = _LEAD_BITS.sub("", _clean_text(raw, 80))
        key = name_key(piece)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(piece)
    return out


def _parse_date(value: Any) -> date | None:
    text = _clean_text(value, 16)
    if not text or not _DATE_RE.match(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _parse_time(value: Any) -> str | None:
    text = _clean_text(value, 8)
    if not text:
        return None
    if len(text) == 5 and _TIME_RE.match(text):
        return text
    return None


def _parse_eaten_at(body: dict[str, Any]) -> datetime:
    raw = body.get("eatenAt") or body.get("when")
    if raw:
        s = _clean_text(raw, 40)
        try:
            if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$", s):
                return datetime.fromisoformat(s).replace(tzinfo=TZ)
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=TZ)
            return dt.astimezone(TZ)
        except ValueError:
            pass
    d = _parse_date(body.get("date")) or today()
    t = _parse_time(body.get("time")) or now_local().strftime("%H:%M")
    hh, mm = t.split(":")
    return datetime(d.year, d.month, d.day, int(hh), int(mm), tzinfo=TZ)


def slot_for_time(hhmm: str) -> str:
    try:
        hh = int(hhmm.split(":")[0])
    except (ValueError, AttributeError, IndexError):
        return "other"
    if 5 <= hh < 11:
        return "breakfast"
    if 11 <= hh < 16:
        return "lunch"
    if 16 <= hh < 19:
        return "snack"
    return "dinner"


def _clamp_level(value: Any) -> str:
    s = _clean_text(value, 12).lower()
    if s in LEVEL_N:
        return s
    aliases = {
        "none": "none",
        "no": "none",
        "zero": "none",
        "trace": "low",
        "little": "low",
        "some": "medium",
        "mid": "medium",
        "moderate": "medium",
        "lots": "high",
        "main": "high",
        "mainly": "high",
        "rich": "high",
    }
    return aliases.get(s, "none") if s in aliases else "none"


def _clean_profile(raw: Any) -> dict[str, str]:
    src = raw if isinstance(raw, dict) else {}
    out = {k: _clamp_level(src.get(k)) for k in MACROS}
    summary = _clean_text(src.get("summary"), 400)
    if summary:
        out["summary"] = summary
    return out


def _empty_profile() -> dict[str, str]:
    return {k: "none" for k in MACROS}


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.is_file():
        return fallback
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback
    return data


def _write_atomic(path: Path, payload: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
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


def _load_unlocked() -> dict[str, Any]:
    items_raw = _read_json(ITEMS_PATH, {"items": []})
    logs_raw = _read_json(LOGS_PATH, {"entries": []})
    plans_raw = _read_json(PLANS_PATH, {"entries": []})
    items = items_raw.get("items") if isinstance(items_raw, dict) else items_raw
    logs = logs_raw.get("entries") if isinstance(logs_raw, dict) else logs_raw
    plans = plans_raw.get("entries") if isinstance(plans_raw, dict) else plans_raw
    return {
        "items": [x for x in (items or []) if isinstance(x, dict)],
        "logs": [x for x in (logs or []) if isinstance(x, dict)],
        "plans": [x for x in (plans or []) if isinstance(x, dict)],
    }


def _save_unlocked(data: dict[str, Any]) -> None:
    _write_atomic(ITEMS_PATH, {"items": data["items"]})
    _write_atomic(LOGS_PATH, {"entries": data["logs"]})
    _write_atomic(PLANS_PATH, {"entries": data["plans"]})


def _find_item(items: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    key = name_key(name)
    if not key:
        return None
    for it in items:
        if it.get("key") == key or name_key(it.get("name")) == key:
            return it
        for alias in it.get("aliases") or []:
            if name_key(alias) == key:
                return it
    return None


def _find_item_id(items: list[dict[str, Any]], iid: str) -> dict[str, Any] | None:
    for it in items:
        if it.get("id") == iid:
            return it
    return None


def _blank_item(name: str, kind: str) -> dict[str, Any]:
    now = _iso_dt(now_local())
    display = _clean_text(name, 80)
    return {
        "id": _new_id("f"),
        "name": display,
        "key": name_key(display),
        "kind": kind if kind in {"dish", "ingredient", "both"} else "dish",
        "aliases": [],
        "constitutes": [],
        "profile": None,
        "timesLogged": 0,
        "timesUsed": 0,
        "createdAt": now,
        "updatedAt": now,
        "source": "manual",
    }


def _merge_kind(current: str | None, incoming: str) -> str:
    cur = current if current in {"dish", "ingredient", "both"} else incoming
    if cur == incoming or incoming == "both" or cur == "both":
        return "both" if cur != incoming else cur
    return "both"


def _upsert_item(
    items: list[dict[str, Any]],
    name: str,
    kind: str,
) -> dict[str, Any]:
    display = _clean_text(name, 80)
    existing = _find_item(items, display)
    now = _iso_dt(now_local())
    if existing:
        existing["kind"] = _merge_kind(existing.get("kind"), kind)
        existing["updatedAt"] = now
        return existing
    item = _blank_item(display, kind)
    items.append(item)
    return item


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "name": item.get("name"),
        "key": item.get("key"),
        "kind": item.get("kind") or "dish",
        "aliases": list(item.get("aliases") or []),
        "constitutes": list(item.get("constitutes") or []),
        "profile": item.get("profile"),
        "timesLogged": int(item.get("timesLogged") or 0),
        "timesUsed": int(item.get("timesUsed") or 0),
        "source": item.get("source") or "manual",
        "updatedAt": item.get("updatedAt"),
    }


def _normalize_constitutes(raw: Any) -> list[dict[str, str]]:
    names: list[str] = []
    if isinstance(raw, str):
        names = split_constitutes(raw)
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, str):
                names.extend(split_constitutes(item))
            elif isinstance(item, dict):
                names.extend(split_constitutes(item.get("name") or item.get("food") or ""))
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for n in names:
        key = name_key(n)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({"name": n})
    return out[:24]


def _needs_ai(
    food_item: dict[str, Any] | None,
    const_items: list[dict[str, Any] | None],
    constitutes: list[dict[str, str]],
) -> bool:
    if food_item is None or not isinstance(food_item.get("profile"), dict):
        return True
    if not constitutes:
        return False
    if len(const_items) != len(constitutes):
        return True
    for it in const_items:
        if it is None or not isinstance(it.get("profile"), dict):
            return True
    return False


def _mainly(profile: dict[str, str] | None) -> str:
    src = profile or {}
    ranked = sorted(
        MACROS,
        key=lambda k: LEVEL_N.get(str(src.get(k) or "none"), 0),
        reverse=True,
    )
    top = [k for k in ranked if LEVEL_N.get(str(src.get(k) or "none"), 0) >= 2]
    if not top:
        mild = [k for k in ranked if LEVEL_N.get(str(src.get(k) or "none"), 0) == 1]
        if not mild:
            return "not profiled yet"
        return "a bit of " + " and ".join(mild[:2])
    if len(top) == 1:
        return f"mainly {top[0]}"
    return f"mainly {top[0]} and {top[1]}"


def _roles(profile: dict[str, str] | None) -> str:
    src = profile or {}
    bits = [
        k
        for k in MACROS
        if LEVEL_N.get(str(src.get(k) or "none"), 0) >= 2
    ]
    if not bits:
        bits = [
            k
            for k in MACROS
            if LEVEL_N.get(str(src.get(k) or "none"), 0) == 1
        ]
    return ", ".join(bits)


def _combine_profiles(profiles: list[dict[str, str] | None]) -> dict[str, str]:
    out = _empty_profile()
    usable = [p for p in profiles if isinstance(p, dict)]
    if not usable:
        return out
    for k in MACROS:
        out[k] = max(
            (_clamp_level(p.get(k)) for p in usable),
            key=lambda lv: LEVEL_N.get(lv, 0),
        )
    return out


def _local_analysis(
    food_item: dict[str, Any],
    const_items: list[dict[str, Any]],
    food_name: str,
) -> dict[str, Any]:
    food_prof = food_item.get("profile") if isinstance(food_item.get("profile"), dict) else None
    ing_profs = [
        it.get("profile") if isinstance(it.get("profile"), dict) else None
        for it in const_items
    ]
    if const_items:
        combined = _combine_profiles(ing_profs + ([food_prof] if food_prof else []))
    else:
        combined = dict(food_prof) if food_prof else _empty_profile()
        combined = {k: combined.get(k, "none") for k in MACROS}

    parts: list[dict[str, str]] = []
    if const_items:
        for it in const_items:
            role = _roles(it.get("profile") if isinstance(it.get("profile"), dict) else None)
            if role:
                parts.append({"name": it.get("name") or "", "role": role})
    elif food_prof:
        role = _roles(food_prof)
        if role:
            parts.append({"name": food_name, "role": role})

    stored = (food_prof or {}).get("summary") if food_prof else ""
    if stored and not const_items:
        summary = stored
    else:
        summary = f"{food_name} is {_mainly(combined)}"
        if parts:
            bits = "; ".join(f"{p['name']} ({p['role']})" for p in parts[:6])
            summary = f"{summary}. {bits}."
        else:
            summary = summary + "."

    return {
        "summary": summary[:400],
        "profile": {k: combined.get(k, "none") for k in MACROS},
        "parts": parts,
        "inferred": not bool(const_items),
        "source": "catalog",
    }


def _meal_from_ai(analysis: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    meal = analysis.get("meal") if isinstance(analysis.get("meal"), dict) else {}
    profile = _clean_profile(meal.get("profile") or fallback.get("profile"))
    profile.pop("summary", None)
    parts_raw = meal.get("parts")
    parts: list[dict[str, str]] = []
    if isinstance(parts_raw, list):
        for p in parts_raw[:12]:
            if not isinstance(p, dict):
                continue
            name = _clean_text(p.get("name"), 80)
            role = _clean_text(p.get("role") or p.get("contributes"), 80)
            if name:
                parts.append({"name": name, "role": role})
    summary = _clean_text(meal.get("summary"), 400) or fallback.get("summary") or ""
    return {
        "summary": summary[:400],
        "profile": {k: profile.get(k, "none") for k in MACROS},
        "parts": parts or fallback.get("parts") or [],
        "inferred": bool(meal.get("inferred")),
        "source": "ai",
    }


def _merge_ai_into_catalog(
    items: list[dict[str, Any]],
    food_item: dict[str, Any],
    const_items: list[dict[str, Any]],
    analysis: dict[str, Any],
) -> None:
    food_block = analysis.get("food") if isinstance(analysis.get("food"), dict) else {}
    food_prof = food_block.get("profile")
    if isinstance(food_prof, dict):
        cleaned = _clean_profile(food_prof)
        summary = _clean_text(food_block.get("summary") or cleaned.get("summary"), 400)
        if summary:
            cleaned["summary"] = summary
        food_item["profile"] = cleaned
        food_item["source"] = "ai"
        food_item["updatedAt"] = _iso_dt(now_local())
    aliases = food_block.get("aliases")
    if isinstance(aliases, list):
        have = {name_key(a) for a in (food_item.get("aliases") or [])}
        extra = []
        for a in aliases[:6]:
            t = _clean_text(a, 80)
            k = name_key(t)
            if t and k and k not in have and k != food_item.get("key"):
                have.add(k)
                extra.append(t)
        if extra:
            food_item["aliases"] = list(food_item.get("aliases") or []) + extra

    by_key = {it.get("key"): it for it in const_items}
    ings = analysis.get("ingredients")
    if not isinstance(ings, list):
        return
    for ing in ings:
        if not isinstance(ing, dict):
            continue
        name = _clean_text(ing.get("name"), 80)
        if not name_key(name):
            continue
        it = by_key.get(name_key(name))
        if it is None:
            # Don't invent kitchen rows the eater didn't log.
            continue
        prof = ing.get("profile")
        if isinstance(prof, dict):
            cleaned = _clean_profile(prof)
            summary = _clean_text(ing.get("summary") or cleaned.get("summary"), 400)
            if summary:
                cleaned["summary"] = summary
            it["profile"] = cleaned
            it["source"] = "ai"
            it["updatedAt"] = _iso_dt(now_local())


def _recount(data: dict[str, Any]) -> None:
    by_id = {it["id"]: it for it in data["items"] if it.get("id")}
    for it in data["items"]:
        it["timesLogged"] = 0
        it["timesUsed"] = 0
    for log in data["logs"]:
        fid = log.get("foodId")
        if fid and fid in by_id:
            by_id[fid]["timesLogged"] = int(by_id[fid].get("timesLogged") or 0) + 1
        for c in log.get("constitutes") or []:
            cid = c.get("id") if isinstance(c, dict) else None
            if cid and cid in by_id:
                by_id[cid]["timesUsed"] = int(by_id[cid].get("timesUsed") or 0) + 1


def _normalize_log_body(body: dict[str, Any]) -> dict[str, Any]:
    food = _clean_text(body.get("food") or body.get("name"), 80)
    if not name_key(food):
        raise ValueError("What you ate is required")
    eaten = _parse_eaten_at(body if isinstance(body, dict) else {})
    constitutes = _normalize_constitutes(
        body.get("constitutes")
        if body.get("constitutes") not in (None, "")
        else body.get("constitutesOf")
    )
    leftover = _clean_text(body.get("constitutesText"), 400)
    if leftover:
        for extra in _normalize_constitutes(leftover):
            if extra["name"] and name_key(extra["name"]) not in {
                name_key(c["name"]) for c in constitutes
            }:
                constitutes.append(extra)
    return {
        "id": _clean_text(body.get("id"), 24) or _new_id("l"),
        "eatenAt": _iso_dt(eaten),
        "date": eaten.date().isoformat(),
        "time": eaten.strftime("%H:%M"),
        "slot": slot_for_time(eaten.strftime("%H:%M")),
        "food": food,
        "foodId": None,
        "constitutes": constitutes,
        "analysis": None,
        "createdAt": _iso_dt(now_local()),
    }


def _bind_entry_items(
    items: list[dict[str, Any]],
    entry: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    food_item = _upsert_item(items, entry["food"], "dish")
    entry["food"] = food_item["name"]
    entry["foodId"] = food_item["id"]
    food_key = food_item.get("key") or ""
    const_items: list[dict[str, Any]] = []
    bound: list[dict[str, str]] = []
    for c in entry.get("constitutes") or []:
        raw_name = c.get("name") if isinstance(c, dict) else str(c)
        if name_key(raw_name) == food_key:
            continue
        it = _upsert_item(items, raw_name, "ingredient")
        const_items.append(it)
        bound.append({"id": it["id"], "name": it["name"]})
    entry["constitutes"] = bound
    food_item["constitutes"] = bound
    food_item["updatedAt"] = _iso_dt(now_local())
    return food_item, const_items


def preview_log(body: dict[str, Any]) -> dict[str, Any]:
    """Validate + snapshot. No writes. Tells caller whether AI is needed."""
    if not isinstance(body, dict):
        raise ValueError("Invalid payload")
    entry = _normalize_log_body(body)
    with _lock:
        data = _load_unlocked()
        food_item = _find_item(data["items"], entry["food"])
        const_items = [
            _find_item(data["items"], c["name"]) for c in entry["constitutes"]
        ]
        needs = _needs_ai(food_item, const_items, entry["constitutes"])
        catalog = [_public_item(i) for i in data["items"]]
    return {"entry": entry, "needs_ai": needs, "catalog": catalog}


def commit_log(
    entry: dict[str, Any],
    *,
    analysis: dict[str, Any] | None = None,
    replace_id: str | None = None,
) -> dict[str, Any]:
    if not isinstance(entry, dict) or not name_key(entry.get("food")):
        raise ValueError("What you ate is required")
    with _lock:
        data = _load_unlocked()
        if replace_id:
            data["logs"] = [x for x in data["logs"] if x.get("id") != replace_id]
            entry["id"] = replace_id
        else:
            # keep provided id unless clash
            ids = {x.get("id") for x in data["logs"]}
            if entry.get("id") in ids:
                entry["id"] = _new_id("l")

        food_item, const_items = _bind_entry_items(data["items"], entry)
        local = _local_analysis(food_item, const_items, entry["food"])
        if analysis:
            _merge_ai_into_catalog(data["items"], food_item, const_items, analysis)
            if not entry.get("constitutes"):
                inferred: list[dict[str, str]] = []
                seen: set[str] = set()
                for ing in analysis.get("ingredients") or []:
                    if not isinstance(ing, dict):
                        continue
                    n = _clean_text(ing.get("name"), 80)
                    k = name_key(n)
                    if not k or k in seen or k == food_item.get("key"):
                        continue
                    seen.add(k)
                    inferred.append({"name": n})
                if inferred:
                    entry["constitutes"] = inferred
                    food_item, const_items = _bind_entry_items(data["items"], entry)
            entry["analysis"] = _meal_from_ai(analysis, local)
        else:
            food_item, const_items = _bind_entry_items(data["items"], entry)
            entry["analysis"] = _local_analysis(food_item, const_items, entry["food"])

        data["logs"].append(entry)
        data["logs"].sort(key=lambda x: str(x.get("eatenAt") or ""), reverse=True)
        _recount(data)
        _save_unlocked(data)
        return {
            "ok": True,
            "entry": entry,
            "items": [_public_item(i) for i in data["items"]],
        }


def delete_log(log_id: str) -> dict[str, Any]:
    lid = _clean_text(log_id, 24)
    with _lock:
        data = _load_unlocked()
        before = len(data["logs"])
        data["logs"] = [x for x in data["logs"] if x.get("id") != lid]
        if len(data["logs"]) == before:
            raise KeyError("Log not found")
        _recount(data)
        _save_unlocked(data)
        return {
            "ok": True,
            "id": lid,
            "items": [_public_item(i) for i in data["items"]],
        }


def _normalize_plan_body(body: dict[str, Any]) -> dict[str, Any]:
    food = _clean_text(body.get("food") or body.get("name"), 80)
    if not name_key(food):
        raise ValueError("What you will eat is required")
    d = _parse_date(body.get("date"))
    if not d:
        raise ValueError("Pick a day")
    t = _parse_time(body.get("time"))
    slot_in = _clean_text(body.get("slot"), 16).lower()
    if slot_in in SLOTS and not t:
        t = {
            "breakfast": "08:00",
            "lunch": "13:00",
            "snack": "17:00",
            "dinner": "20:00",
            "other": "11:00",
        }[slot_in]
    if not t:
        t = "13:00"
    slot = slot_in if slot_in in SLOTS else slot_for_time(t)
    constitutes = _normalize_constitutes(
        body.get("constitutes")
        if body.get("constitutes") not in (None, "")
        else body.get("constitutesOf")
    )
    leftover = _clean_text(body.get("constitutesText"), 400)
    if leftover:
        for extra in _normalize_constitutes(leftover):
            if name_key(extra["name"]) not in {name_key(c["name"]) for c in constitutes}:
                constitutes.append(extra)
    return {
        "id": _clean_text(body.get("id"), 24) or _new_id("p"),
        "date": d.isoformat(),
        "time": t,
        "slot": slot,
        "food": food,
        "foodId": None,
        "constitutes": constitutes,
        "createdAt": _iso_dt(now_local()),
    }


def commit_plan(
    body: dict[str, Any],
    *,
    replace_id: str | None = None,
) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("Invalid payload")
    entry = _normalize_plan_body(body)
    with _lock:
        data = _load_unlocked()
        if replace_id:
            data["plans"] = [x for x in data["plans"] if x.get("id") != replace_id]
            entry["id"] = replace_id
        else:
            ids = {x.get("id") for x in data["plans"]}
            if entry.get("id") in ids:
                entry["id"] = _new_id("p")
        _bind_entry_items(data["items"], entry)
        data["plans"].append(entry)
        data["plans"].sort(key=lambda x: (str(x.get("date") or ""), str(x.get("time") or "")))
        _recount(data)
        _save_unlocked(data)
        return {
            "ok": True,
            "entry": entry,
            "items": [_public_item(i) for i in data["items"]],
        }


def delete_plan(plan_id: str) -> dict[str, Any]:
    pid = _clean_text(plan_id, 24)
    with _lock:
        data = _load_unlocked()
        before = len(data["plans"])
        data["plans"] = [x for x in data["plans"] if x.get("id") != pid]
        if len(data["plans"]) == before:
            raise KeyError("Plan not found")
        _save_unlocked(data)
        return {"ok": True, "id": pid}


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def bootstrap() -> dict[str, Any]:
    n = now_local()
    with _lock:
        data = _load_unlocked()
        items = [_public_item(i) for i in data["items"]]
        logs = list(data["logs"])
        plans = list(data["plans"])
    week = monday_of(n.date())
    return {
        "ok": True,
        "today": n.date().isoformat(),
        "now": _iso_dt(n),
        "timezone": str(TZ),
        "weekStart": week.isoformat(),
        "items": items,
        "logs": logs,
        "plans": plans,
    }
