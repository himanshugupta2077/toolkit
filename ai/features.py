"""Per-use-case on/off flags for Toolkit AI calls.

Stored in data/ai/config.json. Missing keys default to on so existing
behaviour does not change until something is toggled in /ai.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from paths import data_root

VOICE_NOTE_TITLE = "voice.note_title"
VOICE_CLOUD_STT = "voice.cloud_stt"
FOOD_MEAL_PROFILE = "food.meal_profile"
FINANCE_LEDGER = "finance.ledger"
FINANCE_RECEIPT = "finance.receipt"

TOGGLEABLE_IDS: frozenset[str] = frozenset(
    {
        VOICE_NOTE_TITLE,
        VOICE_CLOUD_STT,
        FOOD_MEAL_PROFILE,
        FINANCE_LEDGER,
        FINANCE_RECEIPT,
    }
)

_lock = threading.RLock()


def config_path() -> Path:
    d = data_root() / "ai"
    d.mkdir(parents=True, exist_ok=True)
    return d / "config.json"


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".partial")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def load() -> dict[str, Any]:
    path = config_path()
    if not path.is_file():
        return {"features": {}, "usd_inr": None}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"features": {}, "usd_inr": None}
    if not isinstance(raw, dict):
        return {"features": {}, "usd_inr": None}
    feats = raw.get("features")
    if not isinstance(feats, dict):
        raw["features"] = {}
    return raw


def save(cfg: dict[str, Any]) -> None:
    path = config_path()
    payload = {
        "features": dict(cfg.get("features") or {}),
        "usd_inr": cfg.get("usd_inr"),
    }
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    with _lock:
        _atomic_write(path, text)


def is_on(feature_id: str) -> bool:
    """True unless this use-case was explicitly turned off."""
    feats = load().get("features") or {}
    if feature_id not in feats:
        return True
    return bool(feats[feature_id])


def set_on(feature_id: str, enabled: bool) -> dict[str, Any]:
    if feature_id not in TOGGLEABLE_IDS:
        raise ValueError(f"Unknown AI feature: {feature_id}")
    with _lock:
        cfg = load()
        feats = dict(cfg.get("features") or {})
        feats[feature_id] = bool(enabled)
        cfg["features"] = feats
        save(cfg)
    return {
        "id": feature_id,
        "enabled": bool(enabled),
        "features": dict(load().get("features") or {}),
    }


def flags() -> dict[str, bool]:
    return {fid: is_on(fid) for fid in sorted(TOGGLEABLE_IDS)}


def usd_inr_override() -> float | None:
    raw = load().get("usd_inr")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    if raw <= 0:
        return None
    return float(raw)


def set_usd_inr_override(rate: float | None) -> dict[str, Any]:
    cfg = load()
    if rate is None:
        cfg["usd_inr"] = None
    else:
        value = float(rate)
        if value <= 0 or value > 1000:
            raise ValueError("USD/INR rate must be between 0 and 1000")
        cfg["usd_inr"] = round(value, 4)
    save(cfg)
    return cfg
