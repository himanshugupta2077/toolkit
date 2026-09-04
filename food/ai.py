"""Profile one meal (food + constitutes) via DeepSeek. No calorie counting."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

import ai_usage
from food import store as food_store

AI_MODULE = "food"
AI_ACTION = "Meal profile"

DEFAULT_MODEL = "deepseek-v4-flash"
DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_TIMEOUT_SEC = 45.0
MAX_RETRIES = 2

SYSTEM = """You profile one home-cooked meal for a personal food log.

The eater cooks Indian food and custom experiments (poha, jave, dalia, oats,
curries, mixed vegetables, paneer dishes, random leftover mixes).

You do ONE job: say what this meal is mainly made of.

Levels for carbs, protein, fiber, fat: none | low | medium | high.

Rules:
- Keep the eater's names. Do not rename "poha" to a textbook title.
- If constitutes (ingredients) are listed, the meal profile comes from those
  plus the named food.
- If constitutes are empty, infer a typical makeup of that named food and
  set meal.inferred = true. Still return likely ingredients.
- Known catalog items already exist — reuse their names; you may fill or
  refine missing profiles.
- summary: 1–2 short sentences, spoken like "Poha is mainly carbs from
  flattened rice; paneer adds some protein."
- parts: each ingredient (or the food itself) and what it contributes
  (e.g. "protein, fat").
- No calories, no grams, no medical advice, no extra keys.
- Output ONLY valid JSON matching the schema.
"""


class FoodAIError(Exception):
    def __init__(self, message: str, *, status: str = "error"):
        super().__init__(message)
        self.status = status


def _api_key() -> str:
    key = (
        os.environ.get("DEEPSEEK_API_KEY")
        or os.environ.get("DEEPSEEK_KEY")
        or ""
    ).strip()
    if not key:
        raise FoodAIError(
            "DEEPSEEK_API_KEY is not set.",
            status="config",
        )
    return key


def is_enabled() -> bool:
    return bool(
        (os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("DEEPSEEK_KEY") or "").strip()
    )


def _base_url() -> str:
    return (os.environ.get("DEEPSEEK_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _model() -> str:
    return (os.environ.get("DEEPSEEK_MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL


def _timeout() -> float:
    try:
        return float(os.environ.get("DEEPSEEK_TIMEOUT_SEC") or DEFAULT_TIMEOUT_SEC)
    except ValueError:
        return DEFAULT_TIMEOUT_SEC


def status_payload() -> dict[str, Any]:
    return {
        "enabled": is_enabled(),
        "model": _model(),
        "base_url": _base_url(),
        "thinking": "disabled",
        "api_key_set": is_enabled(),
    }


def _strip_code_fences(text: str) -> str:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _extract_json_object(text: str) -> dict[str, Any]:
    s = _strip_code_fences(text)
    try:
        data = json.loads(s)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(s[start : end + 1])
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError as e:
            raise FoodAIError(f"Model returned invalid JSON: {e}") from e
    raise FoodAIError("Model returned no JSON object")


def _catalog_brief(catalog: list[dict[str, Any]] | None) -> str:
    items = catalog or []
    if not items:
        return "(empty — this is a new kitchen)"
    lines: list[str] = []
    for it in items[:180]:
        name = it.get("name") or ""
        kind = it.get("kind") or "dish"
        prof = it.get("profile") if isinstance(it.get("profile"), dict) else None
        if prof:
            bits = ", ".join(
                f"{k}={prof.get(k)}"
                for k in food_store.MACROS
                if prof.get(k) and prof.get(k) != "none"
            )
            extra = f" [{bits}]" if bits else " [profiled]"
        else:
            extra = " [no profile yet]"
        lines.append(f"- {name} ({kind}){extra}")
    return "\n".join(lines)


def build_user_prompt(entry: dict[str, Any], catalog: list[dict[str, Any]] | None) -> str:
    food = entry.get("food") or ""
    constitutes = entry.get("constitutes") or []
    names = [
        c.get("name") if isinstance(c, dict) else str(c)
        for c in constitutes
    ]
    names = [n for n in names if n]
    return (
        "Schema:\n"
        "{\n"
        '  "food": {\n'
        '    "name": string,\n'
        '    "aliases": [string],\n'
        '    "summary": string,\n'
        '    "profile": {"carbs":"none|low|medium|high","protein":"...","fiber":"...","fat":"..."}\n'
        "  },\n"
        '  "ingredients": [\n'
        '    {"name": string, "summary": string, "profile": {"carbs":"...","protein":"...","fiber":"...","fat":"..."}}\n'
        "  ],\n"
        '  "meal": {\n'
        '    "summary": string,\n'
        '    "inferred": boolean,\n'
        '    "profile": {"carbs":"...","protein":"...","fiber":"...","fat":"..."},\n'
        '    "parts": [{"name": string, "role": string}]\n'
        "  }\n"
        "}\n\n"
        f"Food: {food}\n"
        f"Constitutes of: {json.dumps(names, ensure_ascii=False) if names else '(none given)'}\n\n"
        f"Known kitchen catalog:\n{_catalog_brief(catalog)}\n\n"
        "Return ONLY the JSON object."
    )


def _call_deepseek(system: str, user: str) -> tuple[str, dict[str, Any]]:
    try:
        from openai import OpenAI
    except ImportError as e:
        raise FoodAIError(
            "Python package 'openai' is missing in the whisper venv. "
            "Run: ./whisper/.venv/bin/pip install openai",
            status="config",
        ) from e

    client = OpenAI(
        api_key=_api_key(),
        base_url=_base_url(),
        timeout=_timeout(),
    )
    model = _model()
    last_err: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        t0 = time.perf_counter()
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                stream=False,
                temperature=0.1,
                extra_body={"thinking": {"type": "disabled"}},
            )
            content = (response.choices[0].message.content or "").strip()
            usage = getattr(response, "usage", None)
            tok = ai_usage.extract_usage(usage)
            cost = ai_usage.estimate_cost_usd(
                model=model,
                prompt_tokens=tok["prompt_tokens"],
                completion_tokens=tok["completion_tokens"],
                cache_hit_tokens=tok["cache_hit_tokens"],
                cache_miss_tokens=tok["cache_miss_tokens"],
            )
            meta = {
                "model": model,
                "provider": "deepseek",
                "latency_sec": round(time.perf_counter() - t0, 3),
                "attempt": attempt + 1,
                "prompt_tokens": tok["prompt_tokens"],
                "completion_tokens": tok["completion_tokens"],
                "cache_hit_tokens": tok["cache_hit_tokens"],
                "cache_miss_tokens": tok["cache_miss_tokens"],
                "total_tokens": tok["total_tokens"],
                "cost_usd": cost,
                "action": AI_ACTION,
            }
            if not content:
                raise FoodAIError("Model returned empty content")
            return content, meta
        except FoodAIError:
            raise
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            if attempt < MAX_RETRIES and any(
                x in msg for x in ("timeout", "429", "rate", "503", "502", "connection")
            ):
                time.sleep(0.6 * (attempt + 1))
                continue
            raise FoodAIError(f"DeepSeek API error: {e}") from e

    raise FoodAIError(f"DeepSeek API error: {last_err}")


def analyze(
    entry: dict[str, Any],
    *,
    catalog: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return parsed {food, ingredients, meal} JSON from the model."""
    user = build_user_prompt(entry, catalog)
    try:
        content, meta = _call_deepseek(SYSTEM, user)
    except FoodAIError as e:
        ai_usage.log_call(
            module=AI_MODULE,
            action=AI_ACTION,
            model=_model(),
            provider="deepseek",
            ok=False,
            error=str(e),
        )
        raise

    ai_usage.log_from_meta(meta, module=AI_MODULE, action=AI_ACTION, ok=True)
    parsed = _extract_json_object(content)
    parsed["_meta"] = meta
    return parsed
