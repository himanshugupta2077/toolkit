"""Finance OS text parse mapping (no DeepSeek network)."""

from __future__ import annotations

import pytest

import ai_usage
from finance import os_parse as os
from finance.ai_parse import AIParseError


@pytest.fixture(autouse=True)
def isolate_ai(tmp_path, monkeypatch):
    monkeypatch.setenv("TOOLKIT_DATA", str(tmp_path))
    monkeypatch.setattr(ai_usage, "DATA_DIR", tmp_path / "ai")
    monkeypatch.setattr(ai_usage, "USAGE_PATH", tmp_path / "ai" / "usage.jsonl")
    monkeypatch.setattr(os, "feature_on", lambda _fid: True)


HDFC = {
    "id": "acc_hdfc",
    "name": "HDFC Savings",
    "type": "asset",
    "group": "savings",
    "virtualKind": None,
    "isArchived": False,
}
ICICI = {
    "id": "acc_icici",
    "name": "ICICI Savings",
    "type": "asset",
    "group": "savings",
    "virtualKind": None,
    "isArchived": False,
}
CASH = {
    "id": "acc_cash",
    "name": "Cash",
    "type": "asset",
    "group": "cash",
    "virtualKind": None,
    "isArchived": False,
}
CC = {
    "id": "acc_cc",
    "name": "HDFC Credit Card",
    "type": "liability",
    "group": "credit_card",
    "virtualKind": None,
    "isArchived": False,
}
EXPENSE = {
    "id": "acc_expense",
    "name": "Expense",
    "type": "virtual",
    "group": "virtual",
    "virtualKind": "expense",
    "isArchived": False,
}
EMPLOYER = {
    "id": "acc_employer",
    "name": "Employer",
    "type": "virtual",
    "group": "virtual",
    "virtualKind": "employer",
    "isArchived": False,
}
GROCERIES = {
    "id": "cat_groceries",
    "name": "Groceries",
    "group": "Food",
    "defaultInBudget": True,
    "isArchived": False,
}
EATING = {
    "id": "cat_eating",
    "name": "Eating outside",
    "group": "Food",
    "defaultInBudget": True,
    "isArchived": False,
}
SALARY = {
    "id": "cat_salary",
    "name": "Salary",
    "group": "Income",
    "defaultInBudget": False,
    "isArchived": False,
}

ACCOUNTS = [HDFC, ICICI, CASH, CC, EXPENSE, EMPLOYER]
CATEGORIES = [GROCERIES, EATING, SALARY]


def test_rupees_to_paise():
    assert os.rupees_to_paise(20) == 2000
    assert os.rupees_to_paise(20.5) == 2050
    with pytest.raises(ValueError):
        os.rupees_to_paise(0)


def test_parse_amount():
    assert os.parse_amount_rupees(20) == 20
    assert os.parse_amount_rupees("₹20") == 20
    assert os.parse_amount_rupees("20 rupee") == 20
    assert os.parse_amount_rupees("1,200") == 1200
    assert os.parse_amount_rupees(0) is None


def test_match_savings_and_card():
    assert os.match_account("savings", ACCOUNTS)["id"] == "acc_hdfc"
    assert os.match_account("from savings", ACCOUNTS)["id"] == "acc_hdfc"
    assert os.match_account("ICICI", ACCOUNTS)["id"] == "acc_icici"
    assert os.match_account("card", ACCOUNTS)["id"] == "acc_cc"
    assert os.match_account("HDFC card", ACCOUNTS)["id"] == "acc_cc"
    assert os.match_account("cash", ACCOUNTS)["id"] == "acc_cash"
    assert os.match_account("expense", ACCOUNTS)["id"] == "acc_expense"


def test_match_category_and_fallback():
    assert os.match_category("Groceries", CATEGORIES)["id"] == "cat_groceries"
    assert os.match_category("grocery", CATEGORIES)["id"] == "cat_groceries"
    assert os.match_category(
        None,
        CATEGORIES,
        fallback_names=("Groceries",),
    )["id"] == "cat_groceries"


def test_coerce_curd_from_savings():
    body = os.coerce_os_entry(
        {
            "amount": 20,
            "type": "expense",
            "category": "Groceries",
            "from_account": "savings",
            "to_account": "Expense",
            "include_in_budget": True,
            "notes": "curd",
        },
        accounts=ACCOUNTS,
        categories=CATEGORIES,
        today="2026-09-18",
    )
    assert body["amount"] == 2000
    assert body["type"] == "expense"
    assert body["fromAccountId"] == "acc_hdfc"
    assert body["toAccountId"] == "acc_expense"
    assert body["categoryId"] == "cat_groceries"
    assert body["inBudget"] is True
    assert body["source"] == "ai"
    assert body["notes"] == "curd"
    assert body["date"] == "2026-09-18"


def test_coerce_cc_payment_and_income():
    cc_pay = os.coerce_os_entry(
        {
            "amount": 12000,
            "type": "Credit Card Payment",
            "from_account": "HDFC Savings",
            "to_account": "HDFC Credit Card",
            "category": "missing",
        },
        accounts=ACCOUNTS,
        categories=CATEGORIES,
        today="2026-09-18",
    )
    assert cc_pay["type"] == "cc_payment"
    assert cc_pay["fromAccountId"] == "acc_hdfc"
    assert cc_pay["toAccountId"] == "acc_cc"

    income = os.coerce_os_entry(
        {
            "amount": 140000,
            "type": "income",
            "from_account": "Employer",
            "to_account": "HDFC Savings",
            "category": "Salary",
        },
        accounts=ACCOUNTS,
        categories=CATEGORIES,
        today="2026-09-18",
    )
    assert income["type"] == "income"
    assert income["inBudget"] is False
    assert income["fromAccountId"] == "acc_employer"


def test_coerce_rejects_zero_amount():
    with pytest.raises(AIParseError):
        os.coerce_os_entry(
            {"amount": 0, "type": "expense"},
            accounts=ACCOUNTS,
            categories=CATEGORIES,
            today="2026-09-18",
        )


def test_parse_os_transcript_mocked(monkeypatch):
    def fake_call(system, user, action="Ledger update"):
        assert "curd" in user
        assert "HDFC Savings" in user
        content = json_dumps(
            {
                "entries": [
                    {
                        "amount": 20,
                        "type": "expense",
                        "category": "Groceries",
                        "from_account": "HDFC Savings",
                        "to_account": "Expense",
                        "include_in_budget": True,
                        "notes": "curd",
                    }
                ],
                "confidence": "high",
                "raw_summary": "₹20 curd",
            }
        )
        return content, {"model": "deepseek-v4-flash", "prompt_tokens": 1}

    monkeypatch.setattr(os, "_call_deepseek", fake_call)
    monkeypatch.setattr(os.ai_usage, "log_from_meta", lambda *a, **k: None)

    result = os.parse_os_transcript(
        "curd 20 rupee from savings",
        catalog={
            "today": "2026-09-18",
            "timezone": "Asia/Kolkata",
            "accounts": ACCOUNTS,
            "categories": CATEGORIES,
        },
    )
    assert result["ok"] is True
    assert result["entries"][0]["amount"] == 2000
    assert result["entries"][0]["fromAccountId"] == "acc_hdfc"
    assert result["transcript"] == "curd 20 rupee from savings"


def json_dumps(obj):
    import json

    return json.dumps(obj)


def test_feature_off(monkeypatch):
    monkeypatch.setattr(os, "feature_on", lambda _fid: False)
    with pytest.raises(AIParseError, match="turned off"):
        os.parse_os_transcript("curd 20", catalog={"accounts": ACCOUNTS, "categories": CATEGORIES})


def test_os_docs_load():
    sys = os.os_ledger_system()
    assert "Finance OS" in sys
    assert "PARSE_TASK.md" in sys
    assert "{transcript}" in os.USER_TEMPLATE
