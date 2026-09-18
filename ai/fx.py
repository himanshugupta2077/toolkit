"""USD → INR for the AI spend UI.

Order: manual override in data/ai/config.json, then a 12h Frankfurter
(ECB) cache, then a last-known cache, then a built-in fallback.
Never blocks the UI on a dead network — always returns a number.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ai import features
from paths import data_root

DEFAULT_USD_INR = 88.0
CACHE_TTL_SEC = 12 * 3600
FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=USD&to=INR"


def cache_path() -> Path:
    d = data_root() / "ai"
    d.mkdir(parents=True, exist_ok=True)
    return d / "fx.json"


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _read_cache() -> dict[str, Any] | None:
    path = cache_path()
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    rate = raw.get("usd_inr")
    if not isinstance(rate, (int, float)) or rate <= 0:
        return None
    return raw


def _write_cache(payload: dict[str, Any]) -> None:
    path = cache_path()
    tmp = path.with_suffix(path.suffix + ".partial")
    text = json.dumps(payload, indent=2) + "\n"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def fetch_live() -> dict[str, Any]:
    """Hit Frankfurter. Raises on failure (caller falls back)."""
    req = urllib.request.Request(
        FRANKFURTER_URL,
        headers={"User-Agent": "toolkit-ai/1"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=4) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("fx: unexpected payload")
    rates = data.get("rates") or {}
    rate = rates.get("INR")
    if not isinstance(rate, (int, float)) or rate <= 0:
        raise ValueError("fx: missing INR")
    as_of = str(data.get("date") or "")[:10]
    payload = {
        "usd_inr": round(float(rate), 4),
        "as_of": as_of or None,
        "fetched_at": _utc_now_iso(),
        "source": "frankfurter",
    }
    try:
        _write_cache(payload)
    except OSError:
        pass
    return payload


def get_rate() -> dict[str, Any]:
    override = features.usd_inr_override()
    if override is not None:
        return {
            "usd_inr": round(float(override), 4),
            "as_of": None,
            "source": "override",
            "fetched_at": None,
        }

    cached = _read_cache()
    if cached:
        fetched = str(cached.get("fetched_at") or "")
        age = None
        if fetched:
            try:
                ts = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
                age = time.time() - ts.timestamp()
            except ValueError:
                age = None
        if age is not None and 0 <= age < CACHE_TTL_SEC:
            return {
                "usd_inr": round(float(cached["usd_inr"]), 4),
                "as_of": cached.get("as_of"),
                "source": "cache",
                "fetched_at": cached.get("fetched_at"),
            }

    try:
        live = fetch_live()
        return {
            "usd_inr": live["usd_inr"],
            "as_of": live.get("as_of"),
            "source": "frankfurter",
            "fetched_at": live.get("fetched_at"),
        }
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError, OSError):
        if cached:
            return {
                "usd_inr": round(float(cached["usd_inr"]), 4),
                "as_of": cached.get("as_of"),
                "source": "stale",
                "fetched_at": cached.get("fetched_at"),
            }
        return {
            "usd_inr": DEFAULT_USD_INR,
            "as_of": None,
            "source": "default",
            "fetched_at": None,
        }
