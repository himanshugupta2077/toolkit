"""Registry of every Toolkit LLM / paid-AI call site.

Overview payloads stay small. Full prompts (including live finance docs)
are loaded only for GET /api/ai/use/{id}.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import ai_usage
from ai import features
from ai import fx as ai_fx
from ai import prompts as ai_prompts
from ai.features import (
    FINANCE_LEDGER,
    FINANCE_RECEIPT,
    FOOD_MEAL_PROFILE,
    VOICE_CLOUD_STT,
    VOICE_NOTE_TITLE,
)

VOICE_LOCAL_STT = "voice.local_stt"

# Historical STT rows were tagged module=notes.
MODULE_ALIAS = {
    "notes": "voice",
}

MODULES: list[dict[str, Any]] = [
    {
        "id": "voice",
        "title": "Voice",
        "icon": "🎙",
        "blurb": "Note titles and cloud speech. Local Whisper is free.",
        "href": "/voice/",
        "accent": "#3d8bfd",
    },
    {
        "id": "food",
        "title": "Food",
        "icon": "🍛",
        "blurb": "Meal profiles when you log a dish that is not in the kitchen yet.",
        "href": "/food",
        "accent": "#e2a84a",
    },
    {
        "id": "finance",
        "title": "Finance",
        "icon": "₹",
        "blurb": "Typed or spoken ledger rows in /finance, plus old-finance receipts.",
        "href": "/finance",
        "accent": "#7fd962",
    },
]


def canonical_module(module: str | None) -> str:
    raw = (module or "unknown").strip() or "unknown"
    return MODULE_ALIAS.get(raw, raw)


def _deepseek_key_set() -> bool:
    return bool(
        (os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("DEEPSEEK_KEY") or "").strip()
    )


def _openai_key_set() -> bool:
    return bool(
        (os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENAI_KEY") or "").strip()
    )


def _deepseek_model() -> str:
    return (os.environ.get("DEEPSEEK_MODEL") or "deepseek-v4-flash").strip() or "deepseek-v4-flash"


def _deepseek_base() -> str:
    return (os.environ.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/")


def _openai_base() -> str:
    return (os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")


def _openai_stt_model() -> str:
    return (os.environ.get("OPENAI_STT_MODEL") or "whisper-1").strip() or "whisper-1"


def use_cases() -> list[dict[str, Any]]:
    """Static metadata for every AI use-case. Prompts are filled in detail()."""
    ds_model = _deepseek_model()
    return [
        {
            "id": VOICE_NOTE_TITLE,
            "module": "voice",
            "action": "Note title",
            "log_modules": ["voice"],
            "title": "Note titles",
            "summary": "Short headline from a new recording transcript.",
            "how": (
                "After a new Voice recording is transcribed, DeepSeek reads the "
                "transcript and returns a 3–8 word title. A title you type is never "
                "overwritten. Retranscribe does not retitle a note you already named. "
                "Older notes are not backfilled."
            ),
            "provider": "deepseek",
            "provider_label": "DeepSeek",
            "key_env": "DEEPSEEK_API_KEY",
            "key_id": "deepseek",
            "default_model": ds_model,
            "billed": True,
            "toggleable": True,
            "prompt_kind": "chat",
        },
        {
            "id": VOICE_CLOUD_STT,
            "module": "voice",
            "action": "Cloud transcribe",
            "log_modules": ["voice", "notes"],
            "title": "Cloud speech",
            "summary": "OpenAI whisper-1 when Voice is set to Cloud (and on the VPS).",
            "how": (
                "When Voice — or a finance Speak / receipt voice note — uses Cloud, the "
                "audio is sent to OpenAI whisper-1. Billing is per audio minute, not "
                "tokens. The VPS is cloud-only, so turning this off blocks transcription "
                "there. Laptop Local (Faster Whisper) does not use this key and is not billed."
            ),
            "provider": "openai",
            "provider_label": "OpenAI",
            "key_env": "OPENAI_API_KEY",
            "key_id": "openai",
            "default_model": _openai_stt_model(),
            "billed": True,
            "toggleable": True,
            "prompt_kind": "audio",
        },
        {
            "id": VOICE_LOCAL_STT,
            "module": "voice",
            "action": "Local transcribe",
            "log_modules": [],
            "title": "Local speech",
            "summary": "Faster Whisper on this machine. No API key, not billed.",
            "how": (
                "Laptop-only Faster Whisper. Audio stays on this machine. Pick the "
                "model size in Voice (tiny through large-v3). The VPS does not run this."
            ),
            "provider": "local",
            "provider_label": "This machine",
            "key_env": None,
            "key_id": None,
            "default_model": os.environ.get("WHISPER_MODEL") or "medium",
            "billed": False,
            "toggleable": False,
            "prompt_kind": "local",
        },
        {
            "id": FOOD_MEAL_PROFILE,
            "module": "food",
            "action": "Meal profile",
            "log_modules": ["food"],
            "title": "Meal profile",
            "summary": "Carbs / protein / fiber / fat levels for a logged dish.",
            "how": (
                "When you log a meal whose dish or ingredients have no profile yet, "
                "DeepSeek returns carbs, protein, fiber, and fat as none, low, medium, "
                "or high. It does not count calories. If this is off, the log still "
                "saves; profiles stay empty until you turn it back on."
            ),
            "provider": "deepseek",
            "provider_label": "DeepSeek",
            "key_env": "DEEPSEEK_API_KEY",
            "key_id": "deepseek",
            "default_model": ds_model,
            "billed": True,
            "toggleable": True,
            "prompt_kind": "chat",
        },
        {
            "id": FINANCE_LEDGER,
            "module": "finance",
            "action": "Ledger update",
            "log_modules": ["finance"],
            "title": "Ledger from text",
            "summary": "Typed or spoken money event → one or more /finance ledger rows.",
            "how": (
                "Quick Add in /finance has Type and Speak. Type sends the sentence plus "
                "live SQLite accounts and categories to DeepSeek. Speak records audio, "
                "saves a Voice note (same STT as /voice), then runs this parse. The app "
                "posts the JSON to SQLite with source=ai. Prompt docs in "
                "finance/os_docs/ hot-reload. Old /old-finance still uses Excel docs in "
                "finance/ai_docs/ and the same spend action."
            ),
            "provider": "deepseek",
            "provider_label": "DeepSeek",
            "key_env": "DEEPSEEK_API_KEY",
            "key_id": "deepseek",
            "default_model": ds_model,
            "billed": True,
            "toggleable": True,
            "prompt_kind": "chat",
        },
        {
            "id": FINANCE_RECEIPT,
            "module": "finance",
            "action": "Receipt ledger",
            "log_modules": ["finance"],
            "title": "Receipt → ledger",
            "summary": "Photo (and optional note) → exactly one Ledger row.",
            "how": (
                "Old-finance receipt photos plus an optional typed or voice note go to "
                "DeepSeek. Vision first; if the model rejects images, tesseract OCR is "
                "sent as text. At most one Excel Ledger row per upload. Image prompt "
                "docs live in finance/ai_docs/ and hot-reload."
            ),
            "provider": "deepseek",
            "provider_label": "DeepSeek",
            "key_env": "DEEPSEEK_API_KEY",
            "key_id": "deepseek",
            "default_model": ds_model,
            "billed": True,
            "toggleable": True,
            "prompt_kind": "vision",
        },
    ]


def use_by_id(use_id: str) -> dict[str, Any] | None:
    for item in use_cases():
        if item["id"] == use_id:
            return item
    return None


def match_use(module: str | None, action: str | None) -> dict[str, Any] | None:
    mod = (module or "").strip()
    act = (action or "").strip()
    if not act:
        return None
    for item in use_cases():
        if act != item["action"]:
            continue
        allowed = item.get("log_modules") or [item["module"]]
        if mod in allowed or canonical_module(mod) == item["module"]:
            return item
    return None


def _key_set_for(item: dict[str, Any]) -> bool:
    kid = item.get("key_id")
    if kid == "deepseek":
        return _deepseek_key_set()
    if kid == "openai":
        return _openai_key_set()
    return True


def _runtime_model(item: dict[str, Any]) -> str:
    if item.get("key_id") == "openai":
        return _openai_stt_model()
    if item.get("provider") == "local":
        return str(item.get("default_model") or "medium")
    return _deepseek_model()


def enrich_use(item: dict[str, Any]) -> dict[str, Any]:
    """Flags + live model/key status. No prompt text, no spend."""
    out = dict(item)
    key_set = _key_set_for(item)
    feature_on = True if not item.get("toggleable") else features.is_on(item["id"])
    out["key_set"] = key_set
    out["feature_on"] = feature_on
    out["model"] = _runtime_model(item)
    if not item.get("toggleable"):
        out["state"] = "local"
        out["enabled"] = True
    elif not feature_on:
        out["state"] = "off"
        out["enabled"] = False
    elif not key_set:
        out["state"] = "needs_key"
        out["enabled"] = False
    else:
        out["state"] = "on"
        out["enabled"] = True
    return out


def keys_payload() -> list[dict[str, Any]]:
    uses = use_cases()
    return [
        {
            "id": "deepseek",
            "label": "DeepSeek",
            "env": "DEEPSEEK_API_KEY",
            "set": _deepseek_key_set(),
            "model": _deepseek_model(),
            "base_url": _deepseek_base(),
            "used_by": [u["id"] for u in uses if u.get("key_id") == "deepseek"],
        },
        {
            "id": "openai",
            "label": "OpenAI",
            "env": "OPENAI_API_KEY",
            "set": _openai_key_set(),
            "model": _openai_stt_model(),
            "base_url": _openai_base(),
            "used_by": [u["id"] for u in uses if u.get("key_id") == "openai"],
        },
    ]


def _inr(usd: float | None, rate: float) -> float | None:
    if usd is None:
        return None
    try:
        return round(float(usd) * float(rate), 6)
    except (TypeError, ValueError):
        return None


def _with_inr(row: dict[str, Any], rate: float) -> dict[str, Any]:
    out = dict(row)
    if "cost_usd" in out:
        out["cost_inr"] = _inr(out.get("cost_usd"), rate)
    return out


def _empty_spend() -> dict[str, Any]:
    return {
        "calls": 0,
        "ok_calls": 0,
        "cost_usd": 0.0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "cache_hit_tokens": 0,
        "cache_miss_tokens": 0,
    }


def _find_action_spend(
    by_action: list[dict[str, Any]], item: dict[str, Any]
) -> dict[str, Any]:
    want_mod = item["module"]
    want_act = item["action"]
    extra_mods = set(item.get("log_modules") or [])
    extra_mods.add(want_mod)
    extra_mods = {canonical_module(m) for m in extra_mods}
    merged = _empty_spend()
    hit = False
    for row in by_action:
        if row.get("action") != want_act:
            continue
        if canonical_module(row.get("module")) not in extra_mods:
            continue
        hit = True
        merged["calls"] += int(row.get("calls") or 0)
        merged["ok_calls"] += int(row.get("ok_calls") or 0)
        merged["cost_usd"] = round(
            float(merged["cost_usd"]) + float(row.get("cost_usd") or 0),
            ai_usage._COST_DECIMALS,
        )
        for k in (
            "prompt_tokens",
            "completion_tokens",
            "cache_hit_tokens",
            "cache_miss_tokens",
        ):
            merged[k] += int(row.get(k) or 0)
    return merged if hit else _empty_spend()


def _module_spend(
    by_module: list[dict[str, Any]], module_id: str
) -> dict[str, Any]:
    for row in by_module:
        if canonical_module(row.get("module")) == module_id:
            return row
    return {"module": module_id, **_empty_spend()}


def _docs_list(
    names: tuple[str, ...],
    *,
    directory: Any | None = None,
) -> list[dict[str, str]]:
    from pathlib import Path

    from finance.ai_parse import AI_DOCS_DIR

    root = Path(directory) if directory is not None else AI_DOCS_DIR
    out: list[dict[str, str]] = []
    for name in names:
        path = root / name
        text = ""
        if path.is_file():
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                text = ""
        out.append({"name": name, "text": text, "missing": not bool(text)})
    return out


def prompt_for(item: dict[str, Any]) -> dict[str, Any]:
    uid = item["id"]
    if uid == VOICE_NOTE_TITLE:
        import notes_ai

        payload = {
            "kind": "chat",
            "system": notes_ai.system_prompt(),
            "user_template": ai_prompts.apply_user_template(uid, notes_ai.USER_TEMPLATE),
            "temperature": 0.2,
            "extra_body": {"thinking": {"type": "disabled"}},
            "timeout_sec": notes_ai._timeout(),
            "base_url": notes_ai._base_url(),
            "max_transcript_chars": notes_ai.MAX_TRANSCRIPT_CHARS,
            "docs": [],
        }
        return ai_prompts.annotate(uid, payload)
    if uid == FOOD_MEAL_PROFILE:
        from food import ai as food_ai

        payload = {
            "kind": "chat",
            "system": food_ai.system_prompt(),
            "user_template": ai_prompts.apply_user_template(uid, food_ai.USER_TEMPLATE),
            "temperature": 0.1,
            "extra_body": {"thinking": {"type": "disabled"}},
            "timeout_sec": food_ai._timeout(),
            "base_url": food_ai._base_url(),
            "docs": [],
        }
        return ai_prompts.annotate(uid, payload)
    if uid == FINANCE_LEDGER:
        from finance import ai_parse as finance_ai
        from finance import os_parse as finance_os

        payload = {
            "kind": "chat",
            "system": finance_os.os_ledger_system(),
            "user_template": ai_prompts.apply_user_template(
                uid, finance_os.USER_TEMPLATE
            ),
            "temperature": 0.1,
            "extra_body": {"thinking": {"type": "disabled"}},
            "timeout_sec": finance_ai._timeout(),
            "base_url": finance_ai._base_url(),
            "docs": _docs_list(finance_os.DOC_FILES, directory=finance_os.OS_DOCS_DIR),
        }
        return ai_prompts.annotate(uid, payload)
    if uid == FINANCE_RECEIPT:
        from finance import ai_parse as finance_ai

        payload = {
            "kind": "vision",
            "system": finance_ai.receipt_system(),
            "user_template": ai_prompts.apply_user_template(
                uid, finance_ai.RECEIPT_USER_TEMPLATE
            ),
            "temperature": 0.1,
            "extra_body": {"thinking": {"type": "disabled"}},
            "timeout_sec": finance_ai._timeout(),
            "base_url": finance_ai._base_url(),
            "receipt_mode": finance_ai._receipt_mode(),
            "docs": _docs_list(finance_ai.IMAGE_DOC_FILES),
        }
        return ai_prompts.annotate(uid, payload)
    if uid == VOICE_CLOUD_STT:
        import stt as stt_engine

        return ai_prompts.annotate(
            uid,
            {
                "kind": "audio",
                "system": "",
                "user_template": "",
                "endpoint": "POST {base}/audio/transcriptions  (or /audio/translations if Translate is on)",
                "base_url": stt_engine.openai_base_url(),
                "timeout_sec": stt_engine._timeout(),
                "params": {
                    "model": stt_engine.cloud_model(),
                    "response_format": "verbose_json",
                    "language": "{language or omitted}",
                    "file": "{audio}",
                },
                "docs": [],
            },
        )
    if uid == VOICE_LOCAL_STT:
        return ai_prompts.annotate(
            uid,
            {
                "kind": "local",
                "system": "",
                "user_template": "",
                "engine": "faster-whisper",
                "device": os.environ.get("WHISPER_DEVICE") or "cuda",
                "docs": [],
            },
        )
    return ai_prompts.annotate(
        uid, {"kind": "unknown", "system": "", "user_template": "", "docs": []}
    )


def variables_for(item: dict[str, Any]) -> list[dict[str, str]]:
    uid = item["id"]
    if uid == VOICE_NOTE_TITLE:
        return [
            {
                "name": "transcript",
                "in": "user",
                "source": "New Voice note, clipped to 6000 characters (head + tail).",
            }
        ]
    if uid == VOICE_CLOUD_STT:
        return [
            {"name": "file", "in": "audio", "source": "Uploaded recording (webm/wav/mp3…)."},
            {
                "name": "language",
                "in": "query",
                "source": "Optional BCP-47 hint from Voice settings.",
            },
            {
                "name": "translate",
                "in": "endpoint",
                "source": "Off = transcriptions (what was said). On = translations (English).",
            },
        ]
    if uid == VOICE_LOCAL_STT:
        return [
            {"name": "wav", "in": "file", "source": "ffmpeg 16 kHz WAV of the upload."},
            {"name": "model", "in": "settings", "source": "Voice model picker."},
        ]
    if uid == FOOD_MEAL_PROFILE:
        return [
            {"name": "food", "in": "user", "source": "Dish name from the food log."},
            {
                "name": "constitutes",
                "in": "user",
                "source": "Ingredient names on that log row.",
            },
            {
                "name": "catalog",
                "in": "user",
                "source": "Up to 180 known kitchen items with existing profiles.",
            },
        ]
    if uid == FINANCE_LEDGER:
        return [
            {"name": "today", "in": "user", "source": "Local calendar date (Asia/Kolkata)."},
            {"name": "timezone", "in": "user", "source": "Finance timezone."},
            {
                "name": "types",
                "in": "user",
                "source": "Finance OS ledger types (expense, income, transfer, …).",
            },
            {
                "name": "categories",
                "in": "user",
                "source": "Live category names from the /finance SQLite catalog.",
            },
            {
                "name": "accounts",
                "in": "user",
                "source": "Live account names, groups, and kinds from /finance.",
            },
            {
                "name": "transcript",
                "in": "user",
                "source": "Typed sentence, or Voice transcript after Speak.",
            },
        ]
    if uid == FINANCE_RECEIPT:
        return [
            {"name": "today", "in": "user", "source": "Local calendar date."},
            {"name": "timezone", "in": "user", "source": "Finance timezone."},
            {"name": "types / categories / accounts", "in": "user", "source": "Live workbook lists."},
            {"name": "note", "in": "user", "source": "Typed text and/or receipt voice transcript."},
            {"name": "images", "in": "vision", "source": "Up to 8 photos, resized ~1280px."},
            {
                "name": "ocr_section",
                "in": "user",
                "source": "Tesseract text when vision is off or unsupported.",
            },
        ]
    return []


def overview(*, limit: int = 80) -> dict[str, Any]:
    usage = ai_usage.usage_summary(limit=limit)
    rate_info = ai_fx.get_rate()
    rate = float(rate_info["usd_inr"])
    by_action = usage.get("by_action") or []
    by_module = usage.get("by_module") or []

    modules_out: list[dict[str, Any]] = []
    for mod in MODULES:
        spend = _module_spend(by_module, mod["id"])
        children = [enrich_use(u) for u in use_cases() if u["module"] == mod["id"]]
        for child in children:
            child_spend = _find_action_spend(by_action, child)
            child["calls"] = child_spend["calls"]
            child["cost_usd"] = child_spend["cost_usd"]
            child["cost_inr"] = _inr(child_spend["cost_usd"], rate)
        modules_out.append(
            {
                **mod,
                "calls": int(spend.get("calls") or 0),
                "cost_usd": float(spend.get("cost_usd") or 0),
                "cost_inr": _inr(spend.get("cost_usd"), rate),
                "use_cases": children,
            }
        )

    # Any logged module that is not in the catalog (should be rare).
    known = {m["id"] for m in MODULES}
    for row in by_module:
        mid = canonical_module(row.get("module"))
        if mid in known:
            continue
        modules_out.append(
            {
                "id": mid,
                "title": mid[:1].upper() + mid[1:],
                "icon": "•",
                "blurb": "Logged calls with no catalog entry.",
                "href": None,
                "accent": "#7f8fa6",
                "calls": int(row.get("calls") or 0),
                "cost_usd": float(row.get("cost_usd") or 0),
                "cost_inr": _inr(row.get("cost_usd"), rate),
                "use_cases": [],
            }
        )

    calls = []
    for row in usage.get("calls") or []:
        item = match_use(row.get("module"), row.get("action"))
        enriched = _with_inr(row, rate)
        enriched["module_ui"] = canonical_module(row.get("module"))
        if item:
            enriched["use_id"] = item["id"]
            enriched["use_title"] = item["title"]
        calls.append(enriched)

    def money(block: dict[str, Any]) -> dict[str, Any]:
        return _with_inr(block, rate)

    return {
        "ok": True,
        "fx": rate_info,
        "keys": keys_payload(),
        "flags": features.flags(),
        "totals": money(usage.get("totals") or {}),
        "this_month": money(usage.get("this_month") or {}),
        "by_module": [money({**r, "module": canonical_module(r.get("module"))}) for r in by_module],
        "by_action": [
            money({**r, "module": canonical_module(r.get("module"))}) for r in by_action
        ],
        "by_model": [money(r) for r in (usage.get("by_model") or [])],
        "by_provider": [money(r) for r in (usage.get("by_provider") or [])],
        "by_day": [money(r) for r in (usage.get("by_day") or [])],
        "modules": modules_out,
        "calls": calls,
        "pricing": usage.get("pricing") or {},
        "whisper_pricing": usage.get("whisper_pricing") or {},
        "now": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }


def detail(use_id: str, *, limit: int = 40) -> dict[str, Any] | None:
    item = use_by_id(use_id)
    if not item:
        return None
    usage = ai_usage.usage_summary(limit=max(limit, 80))
    rate_info = ai_fx.get_rate()
    rate = float(rate_info["usd_inr"])
    spend = _find_action_spend(usage.get("by_action") or [], item)
    allowed = set(item.get("log_modules") or [item["module"]])
    recent = []
    for row in usage.get("calls") or []:
        if (row.get("action") or "") != item["action"]:
            continue
        if (row.get("module") or "") not in allowed and canonical_module(
            row.get("module")
        ) != item["module"]:
            continue
        recent.append(_with_inr(row, rate))
        if len(recent) >= limit:
            break
    live = enrich_use(item)
    live["calls"] = spend["calls"]
    live["cost_usd"] = spend["cost_usd"]
    live["cost_inr"] = _inr(spend["cost_usd"], rate)
    return {
        "ok": True,
        "fx": rate_info,
        "keys": keys_payload(),
        "use": live,
        "prompt": prompt_for(item),
        "variables": variables_for(item),
        "spend": {**spend, "cost_inr": _inr(spend["cost_usd"], rate)},
        "calls": recent,
        "module": next((m for m in MODULES if m["id"] == item["module"]), None),
    }


def module_page(module_id: str, *, limit: int = 40) -> dict[str, Any] | None:
    ov = overview(limit=limit)
    for mod in ov["modules"]:
        if mod["id"] == module_id:
            return {
                "ok": True,
                "fx": ov["fx"],
                "keys": ov["keys"],
                "module": mod,
                "calls": [
                    c
                    for c in ov["calls"]
                    if c.get("module_ui") == module_id or canonical_module(c.get("module")) == module_id
                ][:limit],
            }
    return None
