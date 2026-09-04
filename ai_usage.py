"""
Shared AI API usage log + cost estimates.

Every module that calls an LLM should record via `log_call`. Persisted to
data/ai/usage.jsonl so the phone UI can show history + spend across modules.

Cost formula (DeepSeek, verified against platform export + official docs):
  cost_usd =
      (cache_miss_tokens  * input_rate_per_1M
     + cache_hit_tokens   * input_cache_hit_rate_per_1M
     + completion_tokens  * output_rate_per_1M) / 1_000_000

DeepSeek usage always reports:
  prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens
Prefer the explicit miss field when present; fall back to prompt - hit.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data" / "ai"
USAGE_PATH = DATA_DIR / "usage.jsonl"

_lock = threading.Lock()

# Official DeepSeek rates (USD per 1M tokens).
# Source: https://api-docs.deepseek.com/quick_start/pricing/ (checked 2026-08-06)
# Platform export stores the same as per-token prices:
#   miss  0.00000014   (= $0.14 / 1M)
#   hit   0.0000000028 (= $0.0028 / 1M)
#   out   0.00000028   (= $0.28 / 1M)
PRICING_USD_PER_M: dict[str, dict[str, float]] = {
    "deepseek-v4-flash": {
        "input": 0.14,  # cache miss
        "input_cache_hit": 0.0028,
        "output": 0.28,
    },
    "deepseek-v4-pro": {
        "input": 0.435,  # cache miss
        "input_cache_hit": 0.003625,
        "output": 0.87,
    },
}

# Fallback if model id is unknown / alias
DEFAULT_PRICING = PRICING_USD_PER_M["deepseek-v4-flash"]

# Keep enough precision for sub-cent DeepSeek costs without float noise.
_COST_DECIMALS = 10


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def pricing_for(model: str | None) -> dict[str, float]:
    mid = (model or "").strip().lower()
    if mid in PRICING_USD_PER_M:
        return PRICING_USD_PER_M[mid]
    # Aliases / partials
    for key, rates in PRICING_USD_PER_M.items():
        if key in mid or mid in key:
            return rates
    return dict(DEFAULT_PRICING)


def _resolve_hit_miss(
    *,
    prompt_tokens: int | None,
    cache_hit_tokens: int | None,
    cache_miss_tokens: int | None,
) -> tuple[int, int, int]:
    """
    Return (prompt, hit, miss) token counts for billing.

    Prefer explicit DeepSeek fields when present:
      prompt_cache_hit_tokens / prompt_cache_miss_tokens
    Otherwise derive miss = prompt - hit (or hit = prompt - miss).
    """
    pt = int(prompt_tokens or 0)
    hit_raw = cache_hit_tokens
    miss_raw = cache_miss_tokens

    if hit_raw is not None and miss_raw is not None:
        hit = max(0, int(hit_raw))
        miss = max(0, int(miss_raw))
        if pt <= 0:
            pt = hit + miss
        return pt, hit, miss

    if miss_raw is not None:
        miss = max(0, int(miss_raw))
        if pt > 0:
            hit = max(0, pt - miss)
        elif hit_raw is not None:
            hit = max(0, int(hit_raw))
            pt = hit + miss
        else:
            hit = 0
            pt = miss
        return pt, hit, miss

    hit = max(0, int(hit_raw or 0))
    if pt > 0:
        if hit > pt:
            hit = pt
        miss = pt - hit
    else:
        miss = 0
    return pt, hit, miss


def estimate_cost_usd(
    *,
    model: str | None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    cache_hit_tokens: int | None = None,
    cache_miss_tokens: int | None = None,
) -> float | None:
    """
    Estimate USD cost from token counts (DeepSeek billing rules).

    None if there is no billable token data.
    """
    ct = int(completion_tokens or 0)
    pt, hit, miss = _resolve_hit_miss(
        prompt_tokens=prompt_tokens,
        cache_hit_tokens=cache_hit_tokens,
        cache_miss_tokens=cache_miss_tokens,
    )
    if pt <= 0 and ct <= 0 and hit <= 0 and miss <= 0:
        return None

    rates = pricing_for(model)
    # rates are USD per 1M tokens — same as official table / platform export * 1e6
    cost = (
        miss * rates["input"]
        + hit * rates["input_cache_hit"]
        + ct * rates["output"]
    ) / 1_000_000.0
    return round(cost, _COST_DECIMALS)


def extract_usage(usage: Any) -> dict[str, int | None]:
    """Pull token fields from OpenAI/DeepSeek usage object or dict."""
    empty = {
        "prompt_tokens": None,
        "completion_tokens": None,
        "total_tokens": None,
        "cache_hit_tokens": None,
        "cache_miss_tokens": None,
    }
    if usage is None:
        return empty

    def g(name: str, *alts: str) -> int | None:
        for n in (name, *alts):
            if isinstance(usage, dict):
                v = usage.get(n)
            else:
                v = getattr(usage, n, None)
            if v is not None:
                try:
                    return int(v)
                except (TypeError, ValueError):
                    return None
        return None

    # DeepSeek official fields (preferred)
    cache_hit = g(
        "prompt_cache_hit_tokens",
        "cache_hit_tokens",
        "prompt_cache_hit_token_count",
    )
    cache_miss = g(
        "prompt_cache_miss_tokens",
        "cache_miss_tokens",
        "prompt_cache_miss_token_count",
    )
    # Nested prompt_tokens_details.cached_tokens (OpenAI-style)
    if cache_hit is None:
        details = None
        if isinstance(usage, dict):
            details = usage.get("prompt_tokens_details")
        else:
            details = getattr(usage, "prompt_tokens_details", None)
        if details is not None:
            if isinstance(details, dict):
                raw = details.get("cached_tokens")
            else:
                raw = getattr(details, "cached_tokens", None)
            if raw is not None:
                try:
                    cache_hit = int(raw)
                except (TypeError, ValueError):
                    cache_hit = None

    prompt = g("prompt_tokens", "input_tokens")
    completion = g("completion_tokens", "output_tokens")
    total = g("total_tokens")

    # If only hit is known, derive miss from prompt (DeepSeek: prompt = hit + miss)
    if cache_miss is None and prompt is not None and cache_hit is not None:
        cache_miss = max(0, int(prompt) - int(cache_hit))
    elif cache_hit is None and prompt is not None and cache_miss is not None:
        cache_hit = max(0, int(prompt) - int(cache_miss))

    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
        "cache_hit_tokens": cache_hit,
        "cache_miss_tokens": cache_miss,
    }


def log_call(
    *,
    module: str,
    action: str,
    model: str,
    provider: str = "deepseek",
    ok: bool = True,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    cache_hit_tokens: int | None = None,
    cache_miss_tokens: int | None = None,
    total_tokens: int | None = None,
    latency_sec: float | None = None,
    error: str | None = None,
    extra: dict[str, Any] | None = None,
    ts: str | None = None,
    call_id: str | None = None,
) -> dict[str, Any]:
    """
    Append one AI API call to the usage log. Returns the stored record.

    module: e.g. "finance"
    action: short human label, e.g. "Ledger update"
    """
    pt, hit, miss = _resolve_hit_miss(
        prompt_tokens=prompt_tokens,
        cache_hit_tokens=cache_hit_tokens,
        cache_miss_tokens=cache_miss_tokens,
    )
    # Only fill resolved hit/miss when we had any token signal
    has_tokens = any(
        x is not None
        for x in (prompt_tokens, completion_tokens, cache_hit_tokens, cache_miss_tokens)
    )
    if has_tokens:
        if prompt_tokens is None and pt > 0:
            prompt_tokens = pt
        if cache_hit_tokens is None and (hit > 0 or cache_miss_tokens is not None):
            cache_hit_tokens = hit
        if cache_miss_tokens is None and (miss > 0 or cache_hit_tokens is not None):
            cache_miss_tokens = miss
        if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
            total_tokens = int(prompt_tokens) + int(completion_tokens)

    cost = estimate_cost_usd(
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cache_hit_tokens=cache_hit_tokens,
        cache_miss_tokens=cache_miss_tokens,
    )
    record: dict[str, Any] = {
        "id": (call_id or uuid.uuid4().hex[:12]),
        "ts": ts or _utc_now_iso(),
        "module": (module or "unknown").strip() or "unknown",
        "action": (action or "API call").strip() or "API call",
        "model": model or "unknown",
        "provider": provider or "unknown",
        "ok": bool(ok),
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cache_hit_tokens": cache_hit_tokens,
        "cache_miss_tokens": cache_miss_tokens,
        "total_tokens": total_tokens,
        "cost_usd": cost,
        "latency_sec": latency_sec,
        "error": (str(error)[:300] if error else None),
    }
    if extra:
        # Keep log lean — only shallow keys
        for k, v in extra.items():
            if k in record or v is None:
                continue
            if isinstance(v, (str, int, float, bool)):
                record[k] = v
            else:
                record[k] = str(v)[:200]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False) + "\n"
    with _lock:
        with USAGE_PATH.open("a", encoding="utf-8") as f:
            f.write(line)
    return record


def log_from_meta(
    meta: dict[str, Any] | None,
    *,
    module: str,
    action: str,
    ok: bool = True,
    error: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Convenience: log using the meta dict returned by chat completions."""
    if not meta:
        return log_call(
            module=module,
            action=action,
            model="unknown",
            ok=ok,
            error=error,
            extra=extra,
        )
    return log_call(
        module=module,
        action=action,
        model=str(meta.get("model") or "unknown"),
        provider=str(meta.get("provider") or "deepseek"),
        ok=ok,
        prompt_tokens=meta.get("prompt_tokens"),
        completion_tokens=meta.get("completion_tokens"),
        cache_hit_tokens=meta.get("cache_hit_tokens"),
        cache_miss_tokens=meta.get("cache_miss_tokens"),
        total_tokens=meta.get("total_tokens"),
        latency_sec=meta.get("latency_sec"),
        error=error,
        extra=extra,
    )


def _read_all() -> list[dict[str, Any]]:
    if not USAGE_PATH.is_file():
        return []
    out: list[dict[str, Any]] = []
    try:
        text = USAGE_PATH.read_text(encoding="utf-8")
    except OSError:
        return []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


def recent_calls(limit: int = 100) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit or 100), 500))
    rows = _read_all()
    # Newest first
    rows.reverse()
    return rows[:lim]


def _cost_for_row(r: dict[str, Any]) -> float | None:
    """
    Prefer recomputing from tokens + current pricing so rate updates apply.
    Fall back to stored cost_usd when token data is missing.
    """
    recomputed = estimate_cost_usd(
        model=r.get("model"),
        prompt_tokens=r.get("prompt_tokens"),
        completion_tokens=r.get("completion_tokens"),
        cache_hit_tokens=r.get("cache_hit_tokens"),
        cache_miss_tokens=r.get("cache_miss_tokens"),
    )
    if recomputed is not None:
        return recomputed
    c = r.get("cost_usd")
    if isinstance(c, (int, float)):
        return float(c)
    return None


def usage_summary(*, limit: int = 100) -> dict[str, Any]:
    """Payload for GET /api/ai/usage — totals over all time, recent list capped."""
    all_rows = _read_all()
    total_cost = 0.0
    total_prompt = 0
    total_completion = 0
    total_cache_hit = 0
    total_cache_miss = 0
    total_calls = 0
    ok_calls = 0
    by_module: dict[str, dict[str, Any]] = {}

    # Enrich each row with live cost (for UI) without rewriting the log file.
    enriched: list[dict[str, Any]] = []
    for r in all_rows:
        total_calls += 1
        if r.get("ok"):
            ok_calls += 1
        c = _cost_for_row(r)
        if c is not None:
            total_cost += float(c)
        pt = r.get("prompt_tokens")
        ct = r.get("completion_tokens")
        hit = r.get("cache_hit_tokens")
        miss = r.get("cache_miss_tokens")
        if isinstance(pt, int):
            total_prompt += pt
        if isinstance(ct, int):
            total_completion += ct
        if isinstance(hit, int):
            total_cache_hit += hit
        if isinstance(miss, int):
            total_cache_miss += miss
        elif isinstance(pt, int) and isinstance(hit, int):
            total_cache_miss += max(0, pt - hit)

        mod = str(r.get("module") or "unknown")
        bucket = by_module.setdefault(
            mod,
            {
                "module": mod,
                "calls": 0,
                "cost_usd": 0.0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "cache_hit_tokens": 0,
                "cache_miss_tokens": 0,
            },
        )
        bucket["calls"] += 1
        if c is not None:
            bucket["cost_usd"] = round(bucket["cost_usd"] + float(c), 8)
        if isinstance(pt, int):
            bucket["prompt_tokens"] += pt
        if isinstance(ct, int):
            bucket["completion_tokens"] += ct
        if isinstance(hit, int):
            bucket["cache_hit_tokens"] += hit
        if isinstance(miss, int):
            bucket["cache_miss_tokens"] += miss
        elif isinstance(pt, int) and isinstance(hit, int):
            bucket["cache_miss_tokens"] += max(0, pt - hit)

        row = dict(r)
        if c is not None:
            # Match estimate_cost_usd precision (DeepSeek micro-costs).
            row["cost_usd"] = round(float(c), _COST_DECIMALS)
        enriched.append(row)

    for b in by_module.values():
        b["cost_usd"] = round(float(b["cost_usd"]), _COST_DECIMALS)

    lim = max(1, min(int(limit or 100), 500))
    recent = list(reversed(enriched))[:lim]

    return {
        "ok": True,
        "path": str(USAGE_PATH),
        "totals": {
            "calls": total_calls,
            "ok_calls": ok_calls,
            "cost_usd": round(total_cost, _COST_DECIMALS),
            "prompt_tokens": total_prompt,
            "completion_tokens": total_completion,
            "cache_hit_tokens": total_cache_hit,
            "cache_miss_tokens": total_cache_miss,
        },
        "by_module": sorted(by_module.values(), key=lambda x: -x["cost_usd"]),
        "pricing": {
            m: dict(rates) for m, rates in PRICING_USD_PER_M.items()
        },
        "calls": recent,
    }
