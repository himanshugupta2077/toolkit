"""Text/speech → Finance OS ledger payloads via DeepSeek.

Old Excel parse stays in finance.ai_parse. This module maps live SQLite
catalog names onto POST /finance/api/ledger bodies (amount in paise).
It never writes Excel or SQLite — the finance app posts the rows.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import ai_usage
from ai.features import FINANCE_LEDGER, is_on as feature_on
from ai.prompts import apply_user_template, get as prompt_get, render_template
from finance.ai_parse import (
    AIParseError,
    AI_ACTION,
    AI_MODULE,
    _call_deepseek,
    _extract_json_object,
    _model,
)

OS_DOCS_DIR = Path(__file__).resolve().parent / "os_docs"
DOC_FILES = (
    "OVERVIEW.md",
    "PARSE_TASK.md",
    "EXAMPLES.md",
)

SYSTEM_PREFIX = (
    "You are a precise parser for a personal Indian Rupee ledger (Finance OS). "
    "Follow the documentation below exactly. Output ONLY valid JSON.\n\n"
)

USER_TEMPLATE = (
    "Today (local): {today}\n"
    "Timezone: {timezone}\n\n"
    "ALLOWED TYPES:\n{types}\n\n"
    "ALLOWED CATEGORIES:\n{categories}\n\n"
    "ALLOWED ACCOUNTS (name — group — kind):\n{accounts}\n\n"
    "TRANSCRIPT:\n{transcript}\n\n"
    "Return ONLY the JSON object described in PARSE_TASK.md."
)

OS_TYPES = (
    "expense",
    "income",
    "transfer",
    "cc_payment",
    "refund",
    "investment",
    "adjustment",
)

_TYPE_ALIASES = {
    "expense": "expense",
    "income": "income",
    "transfer": "transfer",
    "cc_payment": "cc_payment",
    "credit card payment": "cc_payment",
    "cc payment": "cc_payment",
    "cc pay": "cc_payment",
    "credit-card payment": "cc_payment",
    "refund": "refund",
    "investment": "investment",
    "invest": "investment",
    "adjustment": "adjustment",
    "adjust": "adjustment",
}

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def _load_os_docs(*, overrides: dict[str, str] | None = None) -> str:
    ov = overrides or {}
    parts: list[str] = []
    for name in DOC_FILES:
        text = ""
        if name in ov and str(ov[name]).strip():
            text = str(ov[name]).strip()
        else:
            path = OS_DOCS_DIR / name
            if path.is_file():
                try:
                    text = path.read_text(encoding="utf-8").strip()
                except OSError:
                    text = ""
        if text:
            parts.append(f"### {name}\n\n{text}")
    if not parts:
        parts.append(
            "You extract Finance OS ledger JSON from speech or typed text. "
            "Return only valid JSON with an entries array."
        )
    return "\n\n---\n\n".join(parts)


def os_ledger_system() -> str:
    ov = prompt_get(FINANCE_LEDGER)
    custom = ov.get("system")
    if isinstance(custom, str) and custom.strip():
        return custom
    body = _load_os_docs(overrides=ov.get("docs") or {})
    return SYSTEM_PREFIX + body


def build_user_prompt(
    transcript: str,
    *,
    types: list[str],
    categories: list[str],
    accounts: list[str],
    today: str,
    timezone: str,
) -> str:
    tmpl = apply_user_template(FINANCE_LEDGER, USER_TEMPLATE)
    return render_template(
        tmpl,
        {
            "today": today,
            "timezone": timezone,
            "types": json.dumps(types, ensure_ascii=False),
            "categories": json.dumps(categories, ensure_ascii=False),
            "accounts": json.dumps(accounts, ensure_ascii=False),
            "transcript": transcript.strip(),
        },
    )


def rupees_to_paise(rupees: float) -> int:
    paise = int(round(float(rupees) * 100))
    if paise <= 0:
        raise ValueError("amount must be positive")
    return paise


def parse_amount_rupees(raw: Any) -> float | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        n = float(raw)
        return n if n > 0 else None
    text = str(raw or "").replace(",", "").replace("₹", "").strip()
    if not text:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)", text)
    if not match:
        return None
    n = float(match.group(1))
    return n if n > 0 else None


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _live(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("isArchived") or row.get("is_archived"):
            continue
        if not str(row.get("id") or "").strip():
            continue
        out.append(row)
    return out


def _row_id(row: dict[str, Any]) -> str:
    return str(row.get("id") or "").strip()


def _row_name(row: dict[str, Any]) -> str:
    return str(row.get("name") or "").strip()


def _row_group(row: dict[str, Any]) -> str:
    return str(row.get("group") or row.get("accountGroup") or "").strip().lower()


def _row_kind(row: dict[str, Any]) -> str:
    return str(row.get("virtualKind") or row.get("virtual_kind") or "").strip().lower()


def _row_type(row: dict[str, Any]) -> str:
    return str(row.get("type") or "").strip().lower()


def format_account_line(row: dict[str, Any]) -> str:
    kind = _row_kind(row)
    group = _row_group(row)
    extra = kind or group or _row_type(row)
    return f"{_row_name(row)} — {extra}"


def normalize_type(raw: Any) -> str | None:
    key = _norm(raw)
    if not key:
        return None
    if key in _TYPE_ALIASES:
        return _TYPE_ALIASES[key]
    compact = key.replace(" ", "_")
    if compact in _TYPE_ALIASES:
        return _TYPE_ALIASES[compact]
    return None


def match_account(
    needle: Any,
    accounts: list[dict[str, Any]],
    *,
    prefer_groups: tuple[str, ...] = (),
    prefer_kinds: tuple[str, ...] = (),
) -> dict[str, Any] | None:
    live = _live(accounts)
    if not live:
        return None
    want = _norm(needle)
    if want:
        for row in live:
            if _row_id(row) == str(needle).strip():
                return row
        for row in live:
            if _norm(_row_name(row)) == want:
                return row

        aliases: list[tuple[str, str]] = [
            ("savings", "group:savings"),
            ("hdfc savings", "name:hdfc"),
            ("hdfc", "name:hdfc"),
            ("bank", "group:savings"),
            ("cash", "group:cash"),
            ("wallet", "group:cash"),
            ("credit card", "group:credit_card"),
            ("hdfc card", "name:hdfc"),
            ("hdfc cc", "name:hdfc"),
            ("card", "group:credit_card"),
            ("cc", "group:credit_card"),
            ("salary", "kind:employer"),
            ("employer", "kind:employer"),
            ("expense", "kind:expense"),
            ("spent", "kind:expense"),
            ("external", "kind:external"),
            ("fd", "group:fd"),
            ("mutual fund", "group:investment"),
            ("mf", "group:investment"),
            ("invest", "group:investment"),
        ]
        for alias, rule in aliases:
            if want == alias or alias in want or want in alias:
                kind, _, rest = rule.partition(":")
                hits = live
                if kind == "group":
                    hits = [r for r in live if _row_group(r) == rest]
                elif kind == "kind":
                    hits = [r for r in live if _row_kind(r) == rest]
                elif kind == "name":
                    hits = [r for r in live if rest in _norm(_row_name(r))]
                if rest == "hdfc" and "card" in want:
                    hits = [
                        r
                        for r in hits
                        if _row_group(r) == "credit_card" or "card" in _norm(_row_name(r))
                    ]
                elif rest == "hdfc" and "card" not in want:
                    hits = [r for r in hits if _row_group(r) == "savings"] or hits
                if hits:
                    named = next(
                        (r for r in hits if want in _norm(_row_name(r))),
                        None,
                    )
                    return named or hits[0]

        contains = [r for r in live if want in _norm(_row_name(r)) or _norm(_row_name(r)) in want]
        if len(contains) == 1:
            return contains[0]
        if contains:
            return contains[0]

    if prefer_kinds:
        for kind in prefer_kinds:
            hit = next((r for r in live if _row_kind(r) == kind), None)
            if hit:
                return hit
    if prefer_groups:
        for group in prefer_groups:
            hit = next((r for r in live if _row_group(r) == group), None)
            if hit:
                return hit
    return None


def match_category(
    needle: Any,
    categories: list[dict[str, Any]],
    *,
    fallback_names: tuple[str, ...] = (),
) -> dict[str, Any] | None:
    live = _live(categories)
    if not live:
        return None
    want = _norm(needle)
    if want:
        for row in live:
            if _row_id(row) == str(needle).strip():
                return row
        for row in live:
            if _norm(_row_name(row)) == want:
                return row
        contains = [r for r in live if want in _norm(_row_name(r)) or _norm(_row_name(r)) in want]
        if contains:
            return contains[0]
    for name in fallback_names:
        hit = next((r for r in live if _norm(_row_name(r)) == _norm(name)), None)
        if hit:
            return hit
    return live[0] if live else None


def _default_pair(
    ledger_type: str,
    accounts: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    savings = match_account("savings", accounts, prefer_groups=("savings", "cash"))
    cash = match_account("cash", accounts, prefer_groups=("cash", "savings"))
    card = match_account("credit card", accounts, prefer_groups=("credit_card",))
    expense = match_account("expense", accounts, prefer_kinds=("expense",))
    employer = match_account("employer", accounts, prefer_kinds=("employer", "external"))
    invest = match_account(
        "investment",
        accounts,
        prefer_groups=("fd", "investment"),
    )
    if ledger_type == "expense":
        return savings or cash or card, expense
    if ledger_type == "income":
        return employer, savings or cash
    if ledger_type == "transfer":
        live = [
            r
            for r in _live(accounts)
            if _row_type(r) != "virtual" and _row_kind(r) == ""
        ]
        if len(live) >= 2:
            return live[0], live[1]
        return savings, cash
    if ledger_type == "cc_payment":
        return savings or cash, card
    if ledger_type == "refund":
        return expense, savings or cash or card
    if ledger_type == "investment":
        return savings or cash, invest
    return savings, expense


def _default_in_budget(ledger_type: str, category: dict[str, Any] | None) -> bool:
    if category is not None and isinstance(category.get("defaultInBudget"), bool):
        return bool(category["defaultInBudget"])
    if category is not None and isinstance(category.get("default_in_budget"), bool):
        return bool(category["default_in_budget"])
    return ledger_type in {"expense", "refund"}


def _fallback_category_names(ledger_type: str) -> tuple[str, ...]:
    if ledger_type == "income":
        return ("Salary",)
    if ledger_type == "investment":
        return ("Investment",)
    if ledger_type == "cc_payment":
        return ("Credit Card Bill", "EMIs")
    if ledger_type == "transfer":
        return ("Transfer",)
    if ledger_type == "adjustment":
        return ("Reconciliation",)
    return ("Groceries", "Eating outside", "Other")


def coerce_os_entry(
    raw: dict[str, Any],
    *,
    accounts: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    today: str,
) -> dict[str, Any]:
    ledger_type = normalize_type(raw.get("type")) or "expense"
    amount_rs = parse_amount_rupees(raw.get("amount"))
    if amount_rs is None:
        raise AIParseError("Entry is missing a positive amount", status="validation")
    amount = rupees_to_paise(amount_rs)

    default_from, default_to = _default_pair(ledger_type, accounts)
    from_row = (
        match_account(raw.get("from_account") or raw.get("fromAccount"), accounts)
        or default_from
    )
    to_row = (
        match_account(raw.get("to_account") or raw.get("toAccount"), accounts)
        or default_to
    )
    if from_row is None or to_row is None:
        raise AIParseError("Could not match From/To accounts", status="validation")
    if _row_id(from_row) == _row_id(to_row):
        raise AIParseError("From and To accounts must differ", status="validation")

    category = match_category(
        raw.get("category"),
        categories,
        fallback_names=_fallback_category_names(ledger_type),
    )
    if category is None:
        raise AIParseError("Could not match a category", status="validation")

    in_budget = raw.get("include_in_budget", raw.get("includeInBudget", raw.get("inBudget")))
    if isinstance(in_budget, bool):
        budget = in_budget
    else:
        budget = _default_in_budget(ledger_type, category)

    date_v = raw.get("date")
    date = today
    if date_v and str(date_v).lower() not in {"null", "none", ""}:
        candidate = str(date_v).strip()[:10]
        if _DATE_RE.match(candidate):
            date = candidate

    time_v = raw.get("time")
    time: str | None = None
    if time_v and str(time_v).lower() not in {"null", "none", ""}:
        candidate = str(time_v).strip()[:5]
        if _TIME_RE.match(candidate):
            time = candidate

    notes = str(raw.get("notes") or "").strip()
    return {
        "date": date,
        "time": time,
        "type": ledger_type,
        "amount": amount,
        "fromAccountId": _row_id(from_row),
        "toAccountId": _row_id(to_row),
        "categoryId": _row_id(category),
        "inBudget": budget,
        "notes": notes,
        "source": "ai",
        "fromAccountName": _row_name(from_row),
        "toAccountName": _row_name(to_row),
        "categoryName": _row_name(category),
    }


def catalog_lists(catalog: dict[str, Any]) -> tuple[list[str], list[str], list[str]]:
    types = [str(t) for t in (catalog.get("types") or OS_TYPES)]
    if not types:
        types = list(OS_TYPES)
    categories = [
        _row_name(row)
        for row in _live(list(catalog.get("categories") or []))
        if _row_name(row)
    ]
    accounts = [
        format_account_line(row)
        for row in _live(list(catalog.get("accounts") or []))
        if _row_name(row)
    ]
    return types, categories, accounts


def parse_os_transcript(
    transcript: str,
    *,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Parse text into Finance OS ledger bodies (not yet written)."""
    if not feature_on(FINANCE_LEDGER):
        raise AIParseError(
            "Ledger AI is turned off in the AI app.",
            status="config",
        )
    text = (transcript or "").strip()
    if not text:
        raise AIParseError("Empty transcript", status="empty")

    cat = catalog if isinstance(catalog, dict) else {}
    accounts = [row for row in (cat.get("accounts") or []) if isinstance(row, dict)]
    categories = [row for row in (cat.get("categories") or []) if isinstance(row, dict)]
    if not _live(accounts) or not _live(categories):
        raise AIParseError(
            "Finance catalog is missing accounts or categories.",
            status="validation",
        )

    today = str(cat.get("today") or "").strip() or ""
    timezone = str(cat.get("timezone") or "Asia/Kolkata").strip() or "Asia/Kolkata"
    types, category_names, account_lines = catalog_lists(cat)
    if not today:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        today = datetime.now(ZoneInfo(timezone)).date().isoformat()

    system = os_ledger_system()
    user = build_user_prompt(
        text,
        types=types,
        categories=category_names,
        accounts=account_lines,
        today=today,
        timezone=timezone,
    )

    try:
        content, meta = _call_deepseek(system, user, action=AI_ACTION)
    except AIParseError as e:
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
    entries_raw = parsed.get("entries")
    if entries_raw is None and any(k in parsed for k in ("amount", "type", "category")):
        entries_raw = [parsed]
    if not isinstance(entries_raw, list):
        raise AIParseError("JSON missing entries array")

    if parsed.get("error") and not entries_raw:
        return {
            "ok": False,
            "entries": [],
            "parsed": parsed,
            "meta": meta,
            "error": str(parsed.get("error")),
            "status": "no_entries",
            "transcript": text,
        }
    if not entries_raw:
        return {
            "ok": False,
            "entries": [],
            "parsed": parsed,
            "meta": meta,
            "error": str(parsed.get("error") or "No transactions found"),
            "status": "no_entries",
            "transcript": text,
        }

    payloads: list[dict[str, Any]] = []
    for i, item in enumerate(entries_raw):
        if not isinstance(item, dict):
            raise AIParseError(f"entries[{i}] is not an object")
        if not str(item.get("notes") or "").strip():
            snippet = text.replace("\n", " ").strip()
            if len(snippet) > 120:
                snippet = snippet[:117] + "..."
            item = dict(item)
            item["notes"] = snippet
        payloads.append(
            coerce_os_entry(
                item,
                accounts=accounts,
                categories=categories,
                today=today,
            )
        )

    return {
        "ok": True,
        "entries": payloads,
        "parsed": parsed,
        "meta": meta,
        "status": "parsed",
        "transcript": text,
        "confidence": parsed.get("confidence"),
        "raw_summary": parsed.get("raw_summary"),
    }
