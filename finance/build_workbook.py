#!/usr/bin/env python3
"""
Rebuild finance/Finance Mng.xlsx as a ledger-based single source of truth.

Requires openpyxl:
  ./whisper/.venv/bin/python finance/build_workbook.py

AI / automation policy (see ../AGENTS.md):
  - Default sheet work is SURGICAL on the live Finance-Mng-V2.xlsx — edit only what was asked.
  - Do NOT run --patch-live for small dashboard tweaks; it recreates whole
    Simple + Detailed sheets and wipes LibreOffice layout/copy/chart edits.
  - --patch-live only when the user explicitly requests a full dashboard rebuild.
"""
from __future__ import annotations

from copy import copy
from datetime import date as ddate, datetime
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.chart import BarChart, DoughnutChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.series import DataPoint
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "Finance Mng.xlsx"
# Live workbook under Documents (not the repo copy).
LIVE = Path("/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx")

title_font = Font(name="Calibri", size=16, bold=True, color="1F4E79")
section_font = Font(name="Calibri", size=12, bold=True, color="1F4E79")
header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
muted_font = Font(name="Calibri", size=10, italic=True, color="666666")
money_font = Font(name="Calibri", size=11)
big_num_font = Font(name="Calibri", size=14, bold=True, color="1F4E79")
warn_font = Font(name="Calibri", size=12, bold=True, color="B71C1C")

header_fill = PatternFill("solid", fgColor="1F4E79")
section_fill = PatternFill("solid", fgColor="D6EAF8")
yellow_fill = PatternFill("solid", fgColor="FFF2CC")
calc_fill = PatternFill("solid", fgColor="E8F5E9")
good_fill = PatternFill("solid", fgColor="C8E6C9")
alert_fill = PatternFill("solid", fgColor="FFCDD2")
soft_fill = PatternFill("solid", fgColor="FFF8E1")

thin = Border(
    left=Side(style="thin", color="CCCCCC"),
    right=Side(style="thin", color="CCCCCC"),
    top=Side(style="thin", color="CCCCCC"),
    bottom=Side(style="thin", color="CCCCCC"),
)
inr = "₹#,##0.00"
pct = "0.0%"

# name, type, opening, limit, include_in_net_worth, include_in_liquid_cash, group, notes
ACCOUNTS = [
    ("HDFC Savings", "Asset", 3851.96, None, True, True, "Savings", "Primary savings (Aug-only start)"),
    ("ICICI Savings", "Asset", 142.11, None, True, True, "Savings", ""),
    ("Cash", "Asset", 0, None, True, True, "Cash", ""),
    ("Wallet", "Asset", 0, None, True, True, "Cash", "UPI wallets etc."),
    ("HDFC Credit Card", "Liability", 0, 396000, True, False, "Credit Card", "Opening due; Aug-only = this cycle spends"),
    ("ICICI Credit Card", "Liability", 11723.51, 100000, True, False, "Credit Card", "Opening = due at ledger start"),
    ("FD", "Asset", 0, None, True, False, "FD", "Fixed deposits"),
    ("Mutual Fund", "Asset", 0, None, True, False, "Investment", "Investments"),
    ("Employer", "Virtual", 0, None, False, False, "Virtual", "Counterparty for salary / income"),
    ("Expense", "Virtual", 0, None, False, False, "Virtual", "Counterparty for spends"),
    ("External", "Virtual", 0, None, False, False, "Virtual", "Outside world / unknown source"),
]

ACCOUNT_TYPES = ["Asset", "Liability", "Virtual"]
ACCOUNT_GROUPS = [
    "Savings",
    "Cash",
    "Credit Card",
    "FD",
    "Investment",
    "Virtual",
    "Loan",
    "Other",
]

TYPES = [
    "Income",
    "Expense",
    "Transfer",
    "Credit Card Payment",
    "Refund",
    "Investment",
    "Adjustment",
]

# (name, group, typical_include_in_budget)
# Groups make filtering/review easier; keep old names so existing Ledger rows still match.
CATEGORIES = [
    # Food & drink
    ("Groceries - Online", "Food", True),
    ("Groceries - Physical", "Food", True),
    ("Eating outside", "Food", True),
    ("Food delivery", "Food", True),
    ("Cafe / Snacks", "Food", True),
    # Transport
    ("Petrol", "Transport", True),
    ("Cab / Auto", "Transport", True),
    ("Metro / Bus", "Transport", True),
    ("Parking", "Transport", True),
    ("Vehicle service", "Transport", False),
    # Home & utilities
    ("House cleaning (UC)", "Home", True),
    ("Electricity bill", "Home", True),
    ("Internet / WiFi", "Home", True),
    ("Water / Gas", "Home", True),
    ("Home maintenance", "Home", False),
    ("Household / Kitchen", "Home", True),
    ("Rent", "Home", False),
    # Personal
    ("Salon", "Personal", True),
    ("Pharmacy / Medicine", "Personal", True),
    ("Medical", "Personal", False),
    ("Fitness / Gym", "Personal", True),
    ("Clothes / Fashion", "Personal", True),
    ("Personal care", "Personal", True),
    # Lifestyle & shopping
    ("Subscription", "Lifestyle", True),
    ("Subscription - OTT", "Lifestyle", True),
    ("Subscription - Software", "Lifestyle", True),
    ("Entertainment", "Lifestyle", True),
    ("Shopping - Online", "Lifestyle", True),
    ("Shopping - Offline", "Lifestyle", True),
    ("Gifts", "Lifestyle", True),
    ("Education / Courses", "Lifestyle", False),
    ("Mobile recharge", "Lifestyle", True),
    ("Laptop / Electronics", "Lifestyle", False),
    # Travel
    ("Travel / Flight", "Travel", False),
    ("Hotels / Stay", "Travel", False),
    ("Travel - Local", "Travel", True),
    # Fixed / finance outflows
    ("EMIs", "Fixed", False),
    ("Insurance", "Fixed", False),
    ("Bank Charges", "Fixed", True),
    ("Credit Card Bill", "Fixed", False),
    # Income & inflows
    ("Salary", "Income", False),
    ("Cashback", "Income", False),
    ("Refund", "Income", False),
    ("Reimbursement", "Income", False),
    ("Interest / Dividends", "Income", False),
    ("Bonus", "Income", False),
    # Transfers / investments / adjustments
    ("FD Deposit", "Finance", False),
    ("FD Maturity", "Finance", False),
    ("Investment", "Finance", False),
    ("Transfer", "Finance", False),
    ("Reconciliation", "Finance", False),
    # Catch-all (prefer a specific category when you can)
    ("Other", "Other", True),
]

# Everyday budget cats for the dashboard bar chart (keep readable)
CHART_CATEGORIES = [
    "Groceries - Online",
    "Groceries - Physical",
    "Eating outside",
    "Food delivery",
    "Cafe / Snacks",
    "Petrol",
    "Cab / Auto",
    "Salon",
    "Subscription",
    "Electricity bill",
    "House cleaning (UC)",
    "Shopping - Online",
    "Entertainment",
    "Medical",
    "Other",
]


def style_header_row(ws, row, start_col, end_col):
    for c in range(start_col, end_col + 1):
        cell = ws.cell(row, c)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", wrap_text=True, vertical="center")
        cell.border = thin


def money_cell(cell, formula=None, value=None, editable=False, fill=None):
    if formula is not None:
        cell.value = formula
    elif value is not None:
        cell.value = value
    cell.number_format = inr
    cell.font = money_font
    cell.border = thin
    if fill is not None:
        cell.fill = fill
    else:
        cell.fill = yellow_fill if editable else calc_fill


def _label(cell, text, bold=False):
    cell.value = text
    cell.border = thin
    if bold:
        cell.font = Font(name="Calibri", size=11, bold=True)


def _section(ws, cell_ref, text, merge_to=None):
    cell = ws[cell_ref]
    cell.value = text
    cell.font = section_font
    cell.fill = section_fill
    if merge_to:
        ws.merge_cells(f"{cell_ref}:{merge_to}")


def _clear_sheet(ws, max_row: int = 60, max_col: int = 12) -> None:
    """Wipe values, styles, charts, and merges so a sheet can be fully rebuilt."""
    ws._charts = []
    if ws.merged_cells.ranges:
        for mr in list(ws.merged_cells.ranges):
            ws.unmerge_cells(str(mr))
    if ws.max_row and ws.max_column:
        for row in ws.iter_rows(
            min_row=1,
            max_row=max(ws.max_row, max_row),
            max_col=max(ws.max_column, max_col),
        ):
            for c in row:
                c.value = None
                c.fill = PatternFill()
                c.font = Font()
                c.border = Border()
                c.number_format = "General"


# Configuration account table: header row 10, first account row 11.
# Extra yellow slots sit below the named accounts so a new bank/card/folio
# can be typed without inserting rows (which would desync Reconciliation).
CFG_ACC_HEADER_ROW = 10
CFG_ACC_START = 11
CFG_ACC_EXTRA_ROWS = 10
CFG_ACC_LOOKUP_LAST = 40
REC_ACC_START = 5
REC_ACC_LOOKUP_LAST = 40

_REC_A = f"Reconciliation!$A${REC_ACC_START}:$A${REC_ACC_LOOKUP_LAST}"
_REC_B = f"Reconciliation!$B${REC_ACC_START}:$B${REC_ACC_LOOKUP_LAST}"
_REC_C = f"Reconciliation!$C${REC_ACC_START}:$C${REC_ACC_LOOKUP_LAST}"
_REC_NW = f"Reconciliation!$H${REC_ACC_START}:$H${REC_ACC_LOOKUP_LAST}"
_REC_LIQ = f"Reconciliation!$I${REC_ACC_START}:$I${REC_ACC_LOOKUP_LAST}"
_REC_GRP = f"Reconciliation!$J${REC_ACC_START}:$J${REC_ACC_LOOKUP_LAST}"
_CFG_ACC_NAMES = f"Configuration!$A${CFG_ACC_START}:$A${CFG_ACC_LOOKUP_LAST}"
_CFG_ACC_LIMITS = f"Configuration!$D${CFG_ACC_START}:$D${CFG_ACC_LOOKUP_LAST}"


def _sumifs_true_flag(sum_range: str, flag_range: str, extra: str = "") -> str:
    """Match both boolean TRUE() and the text TRUE (LibreOffice dropdowns)."""
    return (
        f"SUMIFS({sum_range},{flag_range},TRUE(){extra})"
        f"+SUMIFS({sum_range},{flag_range},\"TRUE\"{extra})"
    )


_FORM_LIQUID = "=" + _sumifs_true_flag(_REC_C, _REC_LIQ)
_FORM_CC_DUE = f'=SUMIFS({_REC_C},{_REC_GRP},"Credit Card")'
_FORM_FD = f'=SUMIFS({_REC_C},{_REC_GRP},"FD")'
_FORM_INVESTMENTS = f'=SUMIFS({_REC_C},{_REC_GRP},"Investment")'
_FORM_NW_ASSETS = "=" + _sumifs_true_flag(
    _REC_C, _REC_NW, extra=f',{_REC_B},"Asset"'
)
_FORM_NW_LIABILITIES = "=" + _sumifs_true_flag(
    _REC_C, _REC_NW, extra=f',{_REC_B},"Liability"'
)


def _form_balance_for_label(label_cell: str) -> str:
    """Outstanding/balance from Reconciliation, keyed by the label cell (not a row #)."""
    return f'=IF({label_cell}="","",SUMIF({_REC_A},{label_cell},{_REC_C}))'


def _form_limit_for_label(label_cell: str) -> str:
    return (
        f'=IF({label_cell}="","",IFERROR(INDEX({_CFG_ACC_LIMITS},'
        f"MATCH({label_cell},{_CFG_ACC_NAMES},0)),0))"
    )


def _default_liquid_and_group(name: str, typ: str) -> tuple[bool, str]:
    n = (name or "").strip().lower()
    t = (typ or "").strip()
    if t == "Virtual" or n in {"employer", "expense", "external"}:
        return False, "Virtual"
    if t == "Liability" or "credit card" in n:
        return False, "Credit Card"
    if n == "fd" or n.startswith("fd "):
        return False, "FD"
    if "mutual fund" in n or n in {"mf", "investment"}:
        return False, "Investment"
    if n in {"cash", "wallet"}:
        return True, "Cash"
    if t == "Asset":
        return True, "Savings"
    return False, "Other"
# Monthly Budget month-by-month grid (header row 19, data from row 20).
# Lookups use a long A1 range so LibreOffice can add years without rewriting
# structured table refs back to a frozen $A$20:$A$61.
MB_TABLE_NAME = "MonthlyBudget"
MB_HEADER_ROW = 19
MB_FIRST_DATA_ROW = 20
MB_LOOKUP_LAST_ROW = 200
MB_GRID_END = ddate(2032, 12, 1)

# Ledger empty-row prefill (Day / Month / Year + Include in Budget default).
# Phone append also extends this if the last data row approaches the end.
LEDGER_PREFILL_LAST_ROW = 2000
LEDGER_PREFILL_BUFFER = 80

_FORM_THIS_MONTH_BUDGET = (
    f"=IFERROR(INDEX($B$20:$B${MB_LOOKUP_LAST_ROW},"
    f"MATCH(DATE(YEAR(TODAY()),MONTH(TODAY()),1),$A$20:$A${MB_LOOKUP_LAST_ROW},0)),Configuration!B6)"
)
# Next month's budget from Monthly Budget grid, else Configuration default
_FORM_NEXT_MONTH_BUDGET = (
    f"=IFERROR(INDEX('Monthly Budget'!$B$20:$B${MB_LOOKUP_LAST_ROW},"
    "MATCH(EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),1),"
    f"'Monthly Budget'!$A$20:$A${MB_LOOKUP_LAST_ROW},0)),Configuration!B6)"
)
# Committed cash: CC due + remaining Loan/EMI this month + Planned one-time
# (30d). Remaining EMI prefers Planned Expenses!M6 (SUMIFS on helper cash-due
# columns). SUMIFS on Category=EMIs is the fallback if M6 errors — set
# Active=FALSE when a loan ends. Rent/family stay in budget remaining when
# Include in Budget is TRUE; do not add them here.
_FRAG_PLANNED_MONTHLY_EMIS = (
    "SUMIFS('Planned Expenses'!$D$15:$D$64,'Planned Expenses'!$B$15:$B$64,\"EMIs\","
    "'Planned Expenses'!$C$15:$C$64,\"Monthly\",'Planned Expenses'!$G$15:$G$64,TRUE())"
    "+SUMIFS('Planned Expenses'!$D$15:$D$64,'Planned Expenses'!$B$15:$B$64,\"EMIs\","
    "'Planned Expenses'!$C$15:$C$64,\"Monthly\",'Planned Expenses'!$G$15:$G$64,\"TRUE\")"
)
_FRAG_REMAINING_EMI = (
    f"MAX(0,IFERROR('Planned Expenses'!M6,{_FRAG_PLANNED_MONTHLY_EMIS})"
    f"-'Monthly Budget'!B12)"
)
_FRAG_ONETIME_30 = "IFERROR('Planned Expenses'!B8,0)"
_FORM_NEXT_MONTH_EMI = f"=IFERROR('Planned Expenses'!M7,{_FRAG_PLANNED_MONTHLY_EMIS})"


def _form_committed_cash(cc_cell: str) -> str:
    return f"={cc_cell}+{_FRAG_REMAINING_EMI}+{_FRAG_ONETIME_30}"


def _form_free_less_committed(liquid_cell: str, budget_cell: str, committed_cell: str) -> str:
    return f"={liquid_cell}-{budget_cell}-{committed_cell}"


def _form_free_detailed(*, liquid: str, budget: str, cc: str) -> str:
    return f"={liquid}-{budget}-{cc}-{_FRAG_REMAINING_EMI}-{_FRAG_ONETIME_30}"


def _find_row_by_label(ws, label: str, col: int = 1, max_row: int = 80) -> int | None:
    want = label.strip().lower()
    for r in range(1, max_row + 1):
        v = ws.cell(r, col).value
        if v is not None and str(v).strip().lower() == want:
            return r
    return None


def _find_row_containing(ws, needle: str, col: int = 1, max_row: int = 80) -> int | None:
    want = needle.strip().lower()
    for r in range(1, max_row + 1):
        v = ws.cell(r, col).value
        if v is not None and want in str(v).strip().lower():
            return r
    return None


def _month_start_value(v) -> ddate | None:
    if isinstance(v, datetime):
        return ddate(v.year, v.month, 1)
    if isinstance(v, ddate):
        return ddate(v.year, v.month, 1)
    return None


def _add_calendar_months(start: ddate, n: int) -> ddate:
    m0 = start.month - 1 + n
    return ddate(start.year + m0 // 12, m0 % 12 + 1, 1)


def _ledger_include_in_budget_formula(r: int) -> str:
    """Default Include in Budget on empty Ledger rows.

    Expense / Refund → TRUE(); other types → FALSE(); blank until Date is set.
    Existing filled rows keep explicit =TRUE() / =FALSE() overrides.
    """
    return (
        f'=IF(A{r}="","",IF(OR(F{r}="Expense",F{r}="Refund"),TRUE(),FALSE()))'
    )


def _prefill_ledger_empty_row(led, r: int) -> None:
    """Day/Month/Year + default K, plus yellow input formatting."""
    led.cell(r, 3, f'=IF(A{r}="","",TEXT(A{r},"dddd"))')
    led.cell(r, 4, f'=IF(A{r}="","",TEXT(A{r},"MMMM"))')
    led.cell(r, 5, f'=IF(A{r}="","",YEAR(A{r}))')
    led.cell(r, 11, _ledger_include_in_budget_formula(r))
    for c in (1, 2, 6, 7, 8, 9, 10, 11, 12, 13):
        led.cell(r, c).fill = yellow_fill
        led.cell(r, c).border = thin
    led.cell(r, 7).number_format = inr
    led.cell(r, 1).number_format = "dd/mm/yyyy"
    led.cell(r, 2).number_format = "HH:mm"


def _cfg_bool_text(flag: bool) -> str:
    return "TRUE" if flag else "FALSE"


def _style_config_account_row(cfg, r: int) -> None:
    for c in range(1, 9):
        cfg.cell(r, c).fill = yellow_fill
        cfg.cell(r, c).border = thin
    cfg.cell(r, 3).number_format = inr
    cfg.cell(r, 4).number_format = inr


def _write_config_account_row(
    cfg,
    r: int,
    *,
    name: str | None = None,
    typ: str | None = None,
    opening=None,
    limit=None,
    nw: bool | None = None,
    liquid: bool | None = None,
    group: str | None = None,
    notes: str | None = None,
) -> None:
    _style_config_account_row(cfg, r)
    if name is not None:
        cfg.cell(r, 1, name)
    if typ is not None:
        cfg.cell(r, 2, typ)
    if opening is not None:
        money_cell(cfg.cell(r, 3), value=opening, editable=True)
    if limit is not None:
        money_cell(cfg.cell(r, 4), value=limit, editable=True)
    if nw is not None:
        cfg.cell(r, 5, _cfg_bool_text(nw))
    if liquid is not None:
        cfg.cell(r, 6, _cfg_bool_text(liquid))
    if group is not None:
        cfg.cell(r, 7, group)
    if notes is not None:
        cfg.cell(r, 8, notes)


def _rec_lookup_formula(rec_r: int, cfg_col_letter: str) -> str:
    return (
        f'=IF(A{rec_r}="","",IFERROR(INDEX(Configuration!${cfg_col_letter}${CFG_ACC_START}:'
        f"${cfg_col_letter}${CFG_ACC_LOOKUP_LAST},"
        f"MATCH(A{rec_r},Configuration!$A${CFG_ACC_START}:$A${CFG_ACC_LOOKUP_LAST},0)),\"\"))"
    )


def _apply_rec_class_lookups(rec, rec_r: int) -> None:
    rec.cell(rec_r, 8, _rec_lookup_formula(rec_r, "E")).fill = calc_fill
    rec.cell(rec_r, 8).border = thin
    rec.cell(rec_r, 9, _rec_lookup_formula(rec_r, "F")).fill = calc_fill
    rec.cell(rec_r, 9).border = thin
    rec.cell(rec_r, 10, _rec_lookup_formula(rec_r, "G")).fill = calc_fill
    rec.cell(rec_r, 10).border = thin


def _write_reconciliation_account_row(rec, rec_r: int, cfg_r: int, *, overwrite_actual: bool = False) -> None:
    rec.cell(rec_r, 1, f'=IF(Configuration!A{cfg_r}="","",Configuration!A{cfg_r})').border = thin
    rec.cell(rec_r, 2, f'=IF(Configuration!B{cfg_r}="","",Configuration!B{cfg_r})').border = thin
    calc = (
        f'=IF(A{rec_r}="","",IF(B{rec_r}="Liability",'
        f"Configuration!C{cfg_r}+SUMIF(Ledger!$H:$H,A{rec_r},Ledger!$G:$G)-SUMIF(Ledger!$I:$I,A{rec_r},Ledger!$G:$G),"
        f"Configuration!C{cfg_r}+SUMIF(Ledger!$I:$I,A{rec_r},Ledger!$G:$G)-SUMIF(Ledger!$H:$H,A{rec_r},Ledger!$G:$G)))"
    )
    money_cell(rec.cell(rec_r, 3), formula=calc)
    if overwrite_actual or rec.cell(rec_r, 4).value is None:
        money_cell(rec.cell(rec_r, 4), value=None, editable=True)
    else:
        rec.cell(rec_r, 4).number_format = inr
        rec.cell(rec_r, 4).fill = yellow_fill
        rec.cell(rec_r, 4).border = thin
    money_cell(rec.cell(rec_r, 5), formula=f'=IF(D{rec_r}="","",D{rec_r}-C{rec_r})')
    rec.cell(rec_r, 6).fill = yellow_fill
    rec.cell(rec_r, 6).border = thin
    rec.cell(rec_r, 6).number_format = "dd/mm/yyyy"
    rec.cell(rec_r, 7).fill = yellow_fill
    rec.cell(rec_r, 7).border = thin
    _apply_rec_class_lookups(rec, rec_r)


def _extend_ledger_validation_refs(led, last_row: int) -> list[str]:
    """Widen existing Ledger list validations so new prefill rows keep dropdowns."""
    from openpyxl.utils import range_boundaries

    changed: list[str] = []
    for dv in led.data_validations.dataValidation:
        refs = str(dv.sqref or "").split()
        if not refs:
            continue
        new_refs: list[str] = []
        bumped = False
        for ref in refs:
            try:
                min_col, min_row, max_col, max_row = range_boundaries(ref)
            except ValueError:
                new_refs.append(ref)
                continue
            if max_row < last_row:
                ref = (
                    f"{get_column_letter(min_col)}{min_row}:"
                    f"{get_column_letter(max_col)}{last_row}"
                )
                bumped = True
            new_refs.append(ref)
        if bumped:
            dv.sqref = " ".join(new_refs)
            changed.extend(new_refs)
    return changed


def _monthly_budget_derived_formulas(r: int) -> dict[int, str]:
    """Income / spent / remaining formulas for one month-by-month grid row."""
    L = "Ledger"
    return {
        3: (
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(A{r},"MMMM"),{L}!$E:$E,YEAR(A{r}),'
            f'{L}!$F:$F,"Income")'
        ),
        4: (
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(A{r},"MMMM"),{L}!$E:$E,YEAR(A{r}),'
            f'{L}!$F:$F,"Expense",{L}!$K:$K,TRUE())'
            f'-SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(A{r},"MMMM"),{L}!$E:$E,YEAR(A{r}),'
            f'{L}!$F:$F,"Refund",{L}!$K:$K,TRUE())'
        ),
        5: f"=B{r}-D{r}",
        6: (
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(A{r},"MMMM"),{L}!$E:$E,YEAR(A{r}),'
            f'{L}!$F:$F,"Expense",{L}!$K:$K,FALSE())'
        ),
        7: (
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(A{r},"MMMM"),{L}!$E:$E,YEAR(A{r}),'
            f'{L}!$F:$F,"Investment")'
        ),
        8: (
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(A{r},"MMMM"),{L}!$E:$E,YEAR(A{r}),'
            f'{L}!$J:$J,"EMIs")'
        ),
        9: (
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(A{r},"MMMM"),{L}!$E:$E,YEAR(A{r}),'
            f'{L}!$J:$J,"Rent")'
        ),
        10: (
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(A{r},"MMMM"),{L}!$E:$E,YEAR(A{r}),'
            f'{L}!$F:$F,"Credit Card Payment")'
        ),
        11: f"=C{r}-D{r}-F{r}-G{r}",
        12: f'=TEXT(A{r},"MMMM YYYY")',
    }


def _apply_monthly_budget_derived_row(mb, r: int) -> None:
    for c, formula in _monthly_budget_derived_formulas(r).items():
        if c == 12:
            cell = mb.cell(r, c, formula)
            cell.border = thin
        else:
            money_cell(mb.cell(r, c), formula=formula)


def _write_monthly_budget_month_row(mb, r: int, month_start: ddate, budget) -> None:
    mb.cell(r, 1, month_start).number_format = "mmm yyyy"
    mb.cell(r, 1).border = thin
    money_cell(mb.cell(r, 2), value=budget, editable=True)
    _apply_monthly_budget_derived_row(mb, r)


def _mb_last_date_row(mb) -> int | None:
    last = None
    for r in range(MB_FIRST_DATA_ROW, MB_LOOKUP_LAST_ROW + 1):
        if _month_start_value(mb.cell(r, 1).value) is None:
            break
        last = r
    return last


def _ensure_monthly_budget_table(mb, last_row: int) -> None:
    ref = f"A{MB_HEADER_ROW}:L{last_row}"
    if MB_TABLE_NAME in mb.tables:
        mb.tables[MB_TABLE_NAME].ref = ref
        return
    tab = Table(displayName=MB_TABLE_NAME, ref=ref)
    tab.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium2",
        showFirstColumn=False,
        showLastColumn=False,
        showRowStripes=False,
        showColumnStripes=False,
    )
    mb.add_table(tab)


def _widen_monthly_budget_lookups(wb) -> list[str]:
    """Point THIS MONTH / next-month INDEX-MATCH at the long grid range."""
    replacements = (
        ("$B$20:$B$61", f"$B$20:$B${MB_LOOKUP_LAST_ROW}"),
        ("$A$20:$A$61", f"$A$20:$A${MB_LOOKUP_LAST_ROW}"),
        ("$B$20:$B$67", f"$B$20:$B${MB_LOOKUP_LAST_ROW}"),
        ("$A$20:$A$67", f"$A$20:$A${MB_LOOKUP_LAST_ROW}"),
    )
    changed: list[str] = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                if not isinstance(v, str):
                    continue
                nv = v
                for old, new in replacements:
                    nv = nv.replace(old, new)
                if nv != v:
                    cell.value = nv
                    changed.append(f"{ws.title}!{cell.coordinate}")
    return changed

# Planned Expenses summary anchors (stable cross-sheet refs for dashboards / API docs)
# Sheet layout: summary B5:B10, recurring rows 15–64, one-time rows 68–97
_PE_MONTHLY_FIXED = "='Planned Expenses'!B5"
_PE_RECURRING_COUNT = "='Planned Expenses'!B6"
_PE_YEARLY_COMMIT = "='Planned Expenses'!B7"
_PE_UPCOMING_30 = "='Planned Expenses'!B8"
_PE_UPCOMING_90 = "='Planned Expenses'!B9"
_PE_ONE_TIME_TOTAL = "='Planned Expenses'!B10"

# Sample seed rows for a fresh Planned Expenses sheet (planning only — never Ledger).
_PE_RECURRING_SEED = [
    # expense, category, frequency, amount, start, end, active, notes
    ("Rent", "Rent", "Monthly", 11000, ddate(2026, 8, 1), None, True, ""),
    ("Electricity", "Electricity bill", "Monthly", 1500, ddate(2026, 8, 1), None, True, "estimate"),
    ("Internet", "Internet / WiFi", "Monthly", 900, ddate(2026, 8, 1), None, True, ""),
    ("Spotify", "Subscription - OTT", "Monthly", 119, None, None, True, ""),
    ("Bike Insurance", "Insurance", "Yearly", 1800, ddate(2027, 1, 1), None, True, ""),
    ("Domain Renewal", "Subscription - Software", "Yearly", 3200, ddate(2027, 5, 1), None, True, ""),
]
_PE_ONETIME_SEED = [
    # expense, category, expected_month, expected_date, amount, priority, status, notes
    (
        "Shift to Hyderabad",
        "Other",
        ddate(2026, 9, 1),
        ddate(2026, 9, 15),
        25000,
        "High",
        "Planned",
        "",
    ),
    (
        "Laptop Purchase",
        "Laptop / Electronics",
        ddate(2026, 11, 1),
        None,
        120000,
        "Medium",
        "Planned",
        "",
    ),
    (
        "Vacation",
        "Travel / Flight",
        ddate(2026, 12, 1),
        None,
        35000,
        "Low",
        "Planned",
        "",
    ),
    (
        "OSCP Exam",
        "Education / Courses",
        ddate(2027, 1, 1),
        None,
        170000,
        "High",
        "Planned",
        "",
    ),
]

# Recurring Kind (cash-due buckets on dashboards). Investment is reserved.
PE_KIND_LOAN = "Loan / EMI"
PE_KIND_LIFESTYLE = "Lifestyle"
PE_KIND_INVESTMENT = "Investment"
PE_KIND_CHOICES = (PE_KIND_LOAN, PE_KIND_LIFESTYLE, PE_KIND_INVESTMENT)

# NEXT 6 MONTHS cash-due table on Planned Expenses (stable dashboard refs)
_PE_FORECAST_ORIGIN = "L4"
_PE_FORECAST_MONTH_ROW0 = 6  # L6:P11 = six months; P6 = this month total
PE_REC_START = 15
PE_REC_END = 64
# Helper columns sit to the right of the L4:P13 forecast so dashboard refs stay.
PE_HELP_ACTIVE_COL = 17  # Q Active?
PE_HELP_KIND_COL = 18  # R Effective Kind
PE_HELP_DUE_COL0 = 19  # S..X cash due for L6..L11


def _infer_pe_kind(category: str | None) -> str:
    cat = (category or "").strip()
    if cat == "EMIs":
        return PE_KIND_LOAN
    if cat == "Investment":
        return PE_KIND_INVESTMENT
    return PE_KIND_LIFESTYLE


def _pe_kind_column(ws) -> int:
    """Kind lives in the recurring header row (14). Live book uses K (Payment Method is I)."""
    for c in range(1, 16):
        v = ws.cell(14, c).value
        if v and str(v).strip().lower() == "kind":
            return c
    # Template: Notes at I → Kind at J. Live: Payment Method + Notes → Kind at K.
    notes_at = None
    for c in range(1, 16):
        v = ws.cell(14, c).value
        if v and str(v).strip().lower() == "notes":
            notes_at = c
            break
    return (notes_at + 1) if notes_at else 10


def _pe_cash_due_row_formula(r: int, month_cell: str, active_letter: str) -> str:
    """Per-row cash due in month_cell. Nested IF so MONTH() never sees a blank Start."""
    a = active_letter
    m = month_cell
    return (
        f'=IF(A{r}="","",'
        f'IF(OR({a}{r}=TRUE(),{a}{r}="TRUE"),'
        f'IF(C{r}="Monthly",'
        f'IF(IF(E{r}="",TRUE,E{r}<=EOMONTH({m},0)),'
        f'IF(IF(F{r}="",TRUE,F{r}>={m}),D{r},0),0),'
        f'IF(C{r}="Yearly",'
        f'IF(E{r}="",0,'
        f'IF(MONTH(E{r})<>MONTH({m}),0,'
        f'IF(DATE(YEAR(E{r}),MONTH(E{r}),1)>{m},0,'
        f'IF(IF(F{r}="",TRUE,F{r}>={m}),D{r},0)))),'
        f"0)),0))"
    )


def _pe_effective_kind_formula(r: int, kind_letter: str) -> str:
    k = f"{kind_letter}{r}"
    return (
        f'=IF(A{r}="","",'
        f'IF({k}<>"",{k},'
        f'IF(B{r}="EMIs","{PE_KIND_LOAN}",'
        f'IF(B{r}="Investment","{PE_KIND_INVESTMENT}","{PE_KIND_LIFESTYLE}"))))'
    )


def _pe_active_formula(r: int) -> str:
    return (
        f'=IF(A{r}="","",'
        f'IF(OR(G{r}=TRUE(),G{r}="TRUE"),TRUE(),FALSE()))'
    )


def _unmerge_if_present(ws, ref: str) -> None:
    for mr in list(ws.merged_cells.ranges):
        if str(mr) == ref:
            ws.unmerge_cells(str(mr))
            break


def _write_pe_helper_columns(ws, kind_col: int) -> None:
    """
    Per-row helpers on Q:X (rows 14–64). Used by the 6-month SUMIFS table.
    Does not touch Expense/Category/Amount/Start/End/Active/Kind values.
    """
    kind_letter = get_column_letter(kind_col)
    active_letter = get_column_letter(PE_HELP_ACTIVE_COL)
    eff_letter = get_column_letter(PE_HELP_KIND_COL)
    due0_letter = get_column_letter(PE_HELP_DUE_COL0)
    due5_letter = get_column_letter(PE_HELP_DUE_COL0 + 5)

    _unmerge_if_present(ws, f"{active_letter}13:{due5_letter}13")
    _section(
        ws,
        f"{active_letter}13",
        "HELPERS — per-row formulas for NEXT 6 MONTHS (do not edit)",
        f"{due5_letter}13",
    )

    ws.cell(14, PE_HELP_ACTIVE_COL, "Active?")
    ws.cell(14, PE_HELP_KIND_COL, "Effective Kind")
    for i in range(6):
        cell = ws.cell(14, PE_HELP_DUE_COL0 + i)
        cell.value = f'=TEXT(L{6 + i},"MMM-YYYY")'
    style_header_row(ws, 14, PE_HELP_ACTIVE_COL, PE_HELP_DUE_COL0 + 5)

    for r in range(PE_REC_START, PE_REC_END + 1):
        active_cell = ws.cell(r, PE_HELP_ACTIVE_COL)
        active_cell.value = _pe_active_formula(r)
        active_cell.fill = calc_fill
        active_cell.border = thin
        active_cell.alignment = Alignment(horizontal="center")
        active_cell.number_format = "General"

        kind_cell = ws.cell(r, PE_HELP_KIND_COL)
        kind_cell.value = _pe_effective_kind_formula(r, kind_letter)
        kind_cell.fill = calc_fill
        kind_cell.border = thin

        for i in range(6):
            month_cell = f"$L${6 + i}"
            money_cell(
                ws.cell(r, PE_HELP_DUE_COL0 + i),
                formula=_pe_cash_due_row_formula(r, month_cell, active_letter),
                fill=calc_fill,
            )

    ws.column_dimensions[active_letter].width = 10
    ws.column_dimensions[eff_letter].width = 14
    for i in range(6):
        ws.column_dimensions[get_column_letter(PE_HELP_DUE_COL0 + i)].width = 12

    note_row = PE_REC_END + 1
    note_cell = ws.cell(note_row, PE_HELP_ACTIVE_COL)
    _unmerge_if_present(ws, f"{active_letter}{note_row}:{due5_letter}{note_row}")
    note_cell.value = (
        "Active? normalizes the TRUE/FALSE dropdown. Effective Kind uses Kind, "
        "or infers EMIs → Loan / EMI / Investment → Investment / else Lifestyle. "
        "Cash-due columns are 0 when inactive or outside Start/End. "
        f"NEXT 6 MONTHS M6:O11 = SUMIFS on {eff_letter} + {due0_letter}:{due5_letter}."
    )
    note_cell.font = muted_font
    ws.merge_cells(f"{active_letter}{note_row}:{due5_letter}{note_row}")


def _write_planned_forecast_table(ws, kind_col: int) -> None:
    """Write helper columns + NEXT 6 MONTHS SUMIFS table at L4:P13. Recurring data untouched."""
    _write_pe_helper_columns(ws, kind_col)
    for ref in ("L4:P4", "L13:P13"):
        _unmerge_if_present(ws, ref)
    _section(ws, "L4", "NEXT 6 MONTHS — cash due (Active + Start/End)", "P4")
    headers = ["Month", PE_KIND_LOAN, PE_KIND_LIFESTYLE, PE_KIND_INVESTMENT, "Total"]
    for c, h in enumerate(headers, 12):
        ws.cell(5, c, h)
    style_header_row(ws, 5, 12, 16)

    ws["L6"] = "=DATE(YEAR(TODAY()),MONTH(TODAY()),1)"
    ws["L6"].number_format = "MMM-YYYY"
    ws["L6"].font = Font(bold=True)
    ws["L6"].border = thin
    ws["L6"].fill = calc_fill
    for i in range(1, 6):
        cell = ws.cell(6 + i, 12)
        cell.value = f"=EDATE(L6,{i})"
        cell.number_format = "MMM-YYYY"
        cell.border = thin
        cell.fill = calc_fill

    kinds = (PE_KIND_LOAN, PE_KIND_LIFESTYLE, PE_KIND_INVESTMENT)
    eff = get_column_letter(PE_HELP_KIND_COL)
    for i in range(6):
        r = 6 + i
        due = get_column_letter(PE_HELP_DUE_COL0 + i)
        for k_i, kind in enumerate(kinds):
            header_cell = f"{get_column_letter(13 + k_i)}$5"
            money_cell(
                ws.cell(r, 13 + k_i),
                formula=(
                    f"=SUMIFS(${due}$15:${due}$64,${eff}$15:${eff}$64,{header_cell})"
                ),
                fill=alert_fill if kind == PE_KIND_LOAN else soft_fill,
            )
        money_cell(ws.cell(r, 16), formula=f"=M{r}+N{r}+O{r}", fill=good_fill)
        ws.cell(r, 16).font = Font(bold=True)

    _label(ws.cell(12, 12), "6-month total", bold=True)
    for c, col in enumerate(("M", "N", "O", "P"), 13):
        fill = good_fill if col == "P" else (alert_fill if col == "M" else soft_fill)
        money_cell(ws.cell(12, c), formula=f"=SUM({col}6:{col}11)", fill=fill)
        if col in ("M", "P"):
            ws.cell(12, c).font = Font(bold=True, size=12)

    ws["L13"] = (
        "Cash due that month (not yearly÷12). Loan / EMI = must-pay. "
        "Lifestyle = everyday recurring you can cut. Investment is reserved. "
        "Blank Kind infers EMIs → Loan / EMI, else Lifestyle. "
        "M6:O11 are SUMIFS on helper columns Q:X — audit a month there."
    )
    ws["L13"].font = muted_font
    ws.merge_cells("L13:P13")

    for col, w in zip(list("LMNOP"), [14, 14, 14, 14, 14]):
        ws.column_dimensions[col].width = w


def _ensure_kind_column(ws) -> int:
    """Add Kind header + dropdown + yellow input cells if missing. Returns Kind col."""
    kind_col = _pe_kind_column(ws)
    header = ws.cell(14, kind_col).value
    if not header or str(header).strip().lower() != "kind":
        ws.cell(14, kind_col, "Kind")
        style_header_row(ws, 14, kind_col, kind_col)
    for r in range(15, 65):
        cell = ws.cell(r, kind_col)
        cell.fill = yellow_fill
        cell.border = thin
        if not str(cell.value or "").strip():
            cat = ws.cell(r, 2).value
            name = ws.cell(r, 1).value
            if name:
                cell.value = _infer_pe_kind(str(cat) if cat else "")
    # Dropdown (skip if already covering this column)
    already = False
    for dv in ws.data_validations.dataValidation:
        if dv.sqref and f"{get_column_letter(kind_col)}15" in str(dv.sqref):
            already = True
            break
    if not already:
        choices = ",".join(PE_KIND_CHOICES)
        dv_kind = DataValidation(type="list", formula1=f'"{choices}"', allow_blank=True)
        ws.add_data_validation(dv_kind)
        letter = get_column_letter(kind_col)
        dv_kind.add(f"{letter}15:{letter}64")
    ws.column_dimensions[get_column_letter(kind_col)].width = 14
    return kind_col


def populate_planned_expenses(ws, *, seed: bool = True) -> None:
    """Planning-only sheet: recurring + one-time expected costs. Never touches Ledger."""
    _clear_sheet(ws, max_row=120, max_col=24)
    ws._charts = []

    ws["A1"] = "PLANNED EXPENSES"
    ws["A1"].font = title_font
    ws["A2"] = (
        "Planning only — does not create Ledger entries, change balances, "
        "or affect Monthly Budget / Reconciliation. Edit yellow cells; green = formula."
    )
    ws["A2"].font = muted_font
    ws.merge_cells("A2:I2")

    # ── SUMMARY (fixed anchors B5:B10 for dashboards) ─────────────────
    _section(ws, "A4", "SUMMARY — formulas only (Active recurring + Planned one-time)", "B4")
    # Active matches Configuration style: store/display TRUE|FALSE text (also accept boolean).
    summary_rows = [
        (
            5,
            "Monthly Fixed Cost",
            # This month's recurring cash due (first month of NEXT 6 MONTHS table)
            "=P6",
        ),
        (
            6,
            "Monthly Recurring Count",
            '=COUNTIFS($G$15:$G$64,TRUE,$A$15:$A$64,"<>")'
            '+COUNTIFS($G$15:$G$64,"TRUE",$A$15:$A$64,"<>")',
        ),
        (
            7,
            "Yearly Commitments",
            '=SUMIFS($D$15:$D$64,$C$15:$C$64,"Yearly",$G$15:$G$64,TRUE)'
            '+SUMIFS($D$15:$D$64,$C$15:$C$64,"Yearly",$G$15:$G$64,"TRUE")',
        ),
        (
            8,
            "Upcoming One-Time (Next 30 Days)",
            '=SUMIFS($E$68:$E$97,$G$68:$G$97,"Planned",$I$68:$I$97,">="&TODAY(),$I$68:$I$97,"<="&TODAY()+30)',
        ),
        (
            9,
            "Upcoming One-Time (Next 90 Days)",
            '=SUMIFS($E$68:$E$97,$G$68:$G$97,"Planned",$I$68:$I$97,">="&TODAY(),$I$68:$I$97,"<="&TODAY()+90)',
        ),
        (
            10,
            "Total Planned One-Time",
            '=SUMIF($G$68:$G$97,"Planned",$E$68:$E$97)',
        ),
    ]
    for r, label, formula in summary_rows:
        _label(ws.cell(r, 1), label, bold=True)
        if "Count" in label:
            ws.cell(r, 2).value = formula
            ws.cell(r, 2).font = big_num_font
            ws.cell(r, 2).fill = soft_fill
            ws.cell(r, 2).border = thin
            ws.cell(r, 2).number_format = "0"
        else:
            money_cell(ws.cell(r, 2), formula=formula, fill=soft_fill)
            ws.cell(r, 2).font = big_num_font

    ws["A11"] = (
        "Monthly Fixed Cost = this month's recurring cash due (P6): Active rows whose "
        "Start/End cover this month. Yearly amounts hit their due month, not yearly÷12. "
        "Kind splits Loan / EMI vs Lifestyle vs Investment. Q:X helpers feed the "
        "6-month table via SUMIFS. One-time windows use Effective Date."
    )
    ws["A11"].font = muted_font
    ws.merge_cells("A11:K11")

    # ── SECTION 1 — RECURRING ─────────────────────────────────────────
    _section(ws, "A13", "RECURRING EXPENSES", "J13")
    rec_headers = [
        "Expense",
        "Category",
        "Frequency",
        "Amount",
        "Start",
        "End",
        "Active",
        "Monthly Equivalent",
        "Notes",
        "Kind",
    ]
    for c, h in enumerate(rec_headers, 1):
        ws.cell(14, c, h)
    style_header_row(ws, 14, 1, 10)

    REC_START, REC_END = 15, 64
    for r in range(REC_START, REC_END + 1):
        for c in (1, 2, 3, 5, 6, 7, 9, 10):
            ws.cell(r, c).fill = yellow_fill
            ws.cell(r, c).border = thin
        money_cell(ws.cell(r, 4), value=None, editable=True)
        # Monthly Equivalent: always from Frequency/Amount (Active + dates filter cash-due)
        money_cell(
            ws.cell(r, 8),
            formula=(
                f'=IF(D{r}="","",'
                f'IF(C{r}="Monthly",D{r},'
                f'IF(C{r}="Yearly",ROUND(D{r}/12,2),"")))'
            ),
        )
        ws.cell(r, 5).number_format = "MMM-YYYY"
        ws.cell(r, 6).number_format = "MMM-YYYY"

    if seed:
        for i, row in enumerate(_PE_RECURRING_SEED):
            r = REC_START + i
            exp, cat, freq, amt, start, end, active, notes = row
            ws.cell(r, 1, exp)
            ws.cell(r, 2, cat)
            ws.cell(r, 3, freq)
            money_cell(ws.cell(r, 4), value=amt, editable=True)
            if start is not None:
                ws.cell(r, 5, start)
            if end is not None:
                ws.cell(r, 6, end)
            ws.cell(r, 7, "TRUE" if active else "FALSE")
            ws.cell(r, 9, notes)
            ws.cell(r, 10, _infer_pe_kind(cat))

    # ── SECTION 2 — ONE-TIME ──────────────────────────────────────────
    _section(ws, "A66", "UPCOMING ONE-TIME EXPENSES", "I66")
    ot_headers = [
        "Expense",
        "Category",
        "Expected Month",
        "Expected Date",
        "Amount",
        "Priority",
        "Status",
        "Notes",
        "Effective Date",
    ]
    for c, h in enumerate(ot_headers, 1):
        ws.cell(67, c, h)
    style_header_row(ws, 67, 1, 9)

    OT_START, OT_END = 68, 97
    for r in range(OT_START, OT_END + 1):
        for c in (1, 2, 3, 4, 6, 7, 8):
            ws.cell(r, c).fill = yellow_fill
            ws.cell(r, c).border = thin
        money_cell(ws.cell(r, 5), value=None, editable=True)
        # Effective Date for 30/90 SUMIFS (exact date preferred, else month)
        ws.cell(r, 9).value = (
            f'=IF(A{r}="","",IF(D{r}<>"",D{r},IF(C{r}<>"",C{r},"")))'
        )
        ws.cell(r, 9).fill = calc_fill
        ws.cell(r, 9).border = thin
        ws.cell(r, 9).number_format = "dd-mmm-yyyy"
        ws.cell(r, 3).number_format = "MMM-YYYY"
        ws.cell(r, 4).number_format = "dd-mmm-yyyy"

    if seed:
        for i, row in enumerate(_PE_ONETIME_SEED):
            r = OT_START + i
            exp, cat, emonth, edate, amt, prio, status, notes = row
            ws.cell(r, 1, exp)
            ws.cell(r, 2, cat)
            if emonth is not None:
                ws.cell(r, 3, emonth)
            if edate is not None:
                ws.cell(r, 4, edate)
            money_cell(ws.cell(r, 5), value=amt, editable=True)
            ws.cell(r, 6, prio)
            ws.cell(r, 7, status)
            ws.cell(r, 8, notes)

    # Data validation (lists)
    # Clear any prior validations when rebuilding this sheet alone
    ws.data_validations.dataValidation = []
    dv_freq = DataValidation(type="list", formula1='"Monthly,Yearly"', allow_blank=True)
    dv_active = DataValidation(type="list", formula1='"TRUE,FALSE"', allow_blank=True)
    dv_prio = DataValidation(type="list", formula1='"High,Medium,Low"', allow_blank=True)
    dv_status = DataValidation(
        type="list", formula1='"Planned,Completed,Cancelled"', allow_blank=True
    )
    dv_kind = DataValidation(
        type="list",
        formula1=f'"{",".join(PE_KIND_CHOICES)}"',
        allow_blank=True,
    )
    # Categories from Configuration (same list as Ledger)
    cat_start = 27
    cat_end = 27 + len(CATEGORIES) + 15 - 1  # matches patch_live blank slots
    dv_cat = DataValidation(
        type="list",
        formula1=f"Configuration!$A${cat_start}:$A${cat_end}",
        allow_blank=True,
    )
    for dv in (dv_freq, dv_active, dv_prio, dv_status, dv_kind, dv_cat):
        ws.add_data_validation(dv)
    dv_freq.add(f"C{REC_START}:C{REC_END}")
    dv_active.add(f"G{REC_START}:G{REC_END}")
    dv_kind.add(f"J{REC_START}:J{REC_END}")
    dv_prio.add(f"F{OT_START}:F{OT_END}")
    dv_status.add(f"G{OT_START}:G{OT_END}")
    dv_cat.add(f"B{REC_START}:B{REC_END}")
    dv_cat.add(f"B{OT_START}:B{OT_END}")

    _write_planned_forecast_table(ws, kind_col=10)

    ws["A99"] = (
        "Tips: Kind = Loan / EMI (must-pay) vs Lifestyle (negotiable) vs Investment. "
        "Set Active=FALSE to drop a row from cash-due. End date stops EMIs after the last month. "
        "Do not edit helper columns Q:X. "
        "Mark one-time Status=Completed/Cancelled when done. This sheet never posts to the Ledger."
    )
    ws["A99"].font = muted_font
    ws.merge_cells("A99:J99")

    widths = {
        "A": 22,
        "B": 22,
        "C": 14,
        "D": 14,
        "E": 12,
        "F": 12,
        "G": 12,
        "H": 18,
        "I": 14,
        "J": 14,
        "Q": 10,
        "R": 14,
        "S": 12,
        "T": 12,
        "U": 12,
        "V": 12,
        "W": 12,
        "X": 12,
    }
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A15"
    ws.row_dimensions[14].height = 30
    ws.row_dimensions[67].height = 30


def _add_planned_summary_block(dash, start_row: int, *, cols: str = "D") -> int:
    """
    Write Planned Expenses summary block starting at start_row.
    Returns the last row written. Surgical — does not clear other content.
    cols: merge end column letter for section header (e.g. 'D' or 'F').
    """
    end = cols
    _section(
        dash,
        f"A{start_row}",
        "PLANNED EXPENSES — planning only (not in Ledger / budget)",
        f"{end}{start_row}",
    )
    r = start_row + 1
    rows = [
        ("Monthly fixed cost", _PE_MONTHLY_FIXED, "this month cash due (Start/End + Kind)"),
        ("Monthly recurring count", _PE_RECURRING_COUNT, "active rows"),
        ("Yearly commitments", _PE_YEARLY_COMMIT, "sum of active yearly amounts"),
        ("Upcoming one-time (30 days)", _PE_UPCOMING_30, "Status=Planned"),
        ("Upcoming one-time (90 days)", _PE_UPCOMING_90, "Status=Planned"),
        ("Total planned one-time", _PE_ONE_TIME_TOTAL, "all Status=Planned"),
    ]
    for label, formula, note in rows:
        _label(dash.cell(r, 1), label, bold=("fixed" in label.lower() or "total" in label.lower()))
        if "count" in label.lower():
            dash.cell(r, 2).value = formula
            dash.cell(r, 2).font = big_num_font
            dash.cell(r, 2).fill = soft_fill
            dash.cell(r, 2).border = thin
            dash.cell(r, 2).number_format = "0"
        else:
            fill = good_fill if "fixed" in label.lower() else soft_fill
            if "30" in label or "90" in label:
                fill = alert_fill if "30" in label else soft_fill
            money_cell(dash.cell(r, 2), formula=formula, fill=fill)
            if "fixed" in label.lower() or "total" in label.lower():
                dash.cell(r, 2).font = Font(bold=True, size=12)
        dash.cell(r, 3).value = note
        dash.cell(r, 3).font = muted_font
        r += 1
    dash.cell(r, 1).value = (
        "Edit lists on the Planned Expenses sheet. Active=FALSE excludes a recurring row "
        "from monthly fixed cost. Does not create Ledger entries."
    )
    dash.cell(r, 1).font = muted_font
    dash.merge_cells(f"A{r}:{end}{r}")
    return r


def _add_commitment_forecast_block(dash, start_row: int, *, cols: str = "E") -> int:
    """
    NEXT 6 MONTHS recurring cash-due table. Refs Planned Expenses!L6:P12.
    Surgical — does not clear other content. Returns last row written.
    """
    end = cols
    _section(
        dash,
        f"A{start_row}",
        "NEXT 6 MONTHS — recurring cash due",
        f"{end}{start_row}",
    )
    hr = start_row + 1
    headers = ["Month", PE_KIND_LOAN, PE_KIND_LIFESTYLE, PE_KIND_INVESTMENT, "Total"]
    for c, h in enumerate(headers, 1):
        dash.cell(hr, c, h)
    style_header_row(dash, hr, 1, 5)

    for i in range(6):
        r = hr + 1 + i
        src = _PE_FORECAST_MONTH_ROW0 + i
        dash.cell(r, 1).value = f"='Planned Expenses'!L{src}"
        dash.cell(r, 1).number_format = "MMM-YYYY"
        dash.cell(r, 1).border = thin
        dash.cell(r, 1).fill = calc_fill
        money_cell(
            dash.cell(r, 2),
            formula=f"='Planned Expenses'!M{src}",
            fill=alert_fill,
        )
        money_cell(
            dash.cell(r, 3),
            formula=f"='Planned Expenses'!N{src}",
            fill=soft_fill,
        )
        money_cell(
            dash.cell(r, 4),
            formula=f"='Planned Expenses'!O{src}",
            fill=soft_fill,
        )
        money_cell(
            dash.cell(r, 5),
            formula=f"='Planned Expenses'!P{src}",
            fill=good_fill,
        )
        dash.cell(r, 5).font = Font(bold=True)

    tot = hr + 7
    _label(dash.cell(tot, 1), "6-month total", bold=True)
    money_cell(dash.cell(tot, 2), formula="='Planned Expenses'!M12", fill=alert_fill)
    money_cell(dash.cell(tot, 3), formula="='Planned Expenses'!N12", fill=soft_fill)
    money_cell(dash.cell(tot, 4), formula="='Planned Expenses'!O12", fill=soft_fill)
    money_cell(dash.cell(tot, 5), formula="='Planned Expenses'!P12", fill=good_fill)
    dash.cell(tot, 2).font = Font(bold=True)
    dash.cell(tot, 5).font = Font(bold=True, size=12)

    note = tot + 1
    dash.cell(note, 1).value = (
        "Loan / EMI = must-pay (EMI, loans). Lifestyle = everyday recurring you can cut. "
        "Investment is reserved (0 until you tag rows). Dates from Planned Expenses Start/End. "
        "MacBook SmartEMI is Loan / EMI for Sep-2026 through Feb-2027."
    )
    dash.cell(note, 1).font = muted_font
    dash.merge_cells(f"A{note}:{end}{note}")
    dash.row_dimensions[note].height = 32
    for col_letter, w in zip(list("ABCDE"), [22, 14, 14, 14, 14]):
        current = dash.column_dimensions[col_letter].width
        if not current or current < w:
            dash.column_dimensions[col_letter].width = w
    return note


def _dashboard_has_block(dash, needle: str, max_row: int = 120) -> bool:
    key = needle.upper()
    for r in range(1, min(dash.max_row or 1, max_row) + 1):
        v = dash.cell(r, 1).value
        if v and key in str(v).upper():
            return True
    return False


def populate_simple_dashboard(dash) -> None:
    """Minimal dashboard: month pace, CC bills, free-to-allocate, next-month estimate."""
    _clear_sheet(dash, max_row=50, max_col=6)

    dash["A1"] = "SIMPLE DASHBOARD"
    dash["A1"].font = title_font
    dash["A2"] = (
        "Only what matters day-to-day. Charts & full balances live on Detailed Dashboard."
    )
    dash["A2"].font = muted_font
    dash.merge_cells("A2:D2")

    # ── THIS MONTH / PACE ──────────────────────────────────────────────
    _section(dash, "A4", "THIS MONTH — PACE", "D4")

    _label(dash["A5"], "Month")
    dash["B5"] = '=TEXT(TODAY(),"MMMM YYYY")'
    dash["B5"].font = Font(bold=True, size=12, color="1F4E79")
    dash["B5"].border = thin

    _label(dash["C5"], "Days left")
    # Include today; integer format (LibreOffice otherwise shows a date serial).
    dash["D5"] = "=EOMONTH(TODAY(),0)-TODAY()+1"
    dash["D5"].font = big_num_font
    dash["D5"].fill = soft_fill
    dash["D5"].border = thin
    dash["D5"].number_format = "0"
    dash["D5"].alignment = Alignment(horizontal="center")

    _label(dash["A6"], "Budget remaining", bold=True)
    money_cell(dash["B6"], formula="='Monthly Budget'!B9", fill=good_fill)
    dash["B6"].font = big_num_font

    _label(dash["C6"], "Safe to spend / day", bold=True)
    money_cell(
        dash["D6"],
        formula="=IF(D5<=0,0,MAX(0,B6)/D5)",
        fill=soft_fill,
    )
    dash["D6"].font = big_num_font

    _label(dash["A7"], "Budget used %")
    dash["B7"] = "='Monthly Budget'!B16"
    dash["B7"].number_format = pct
    dash["B7"].fill = calc_fill
    dash["B7"].border = thin

    _label(dash["C7"], "Month elapsed %")
    dash["D7"] = "=DAY(TODAY())/DAY(EOMONTH(TODAY(),0))"
    dash["D7"].number_format = pct
    dash["D7"].fill = calc_fill
    dash["D7"].border = thin

    _label(dash["A8"], "Pace check", bold=True)
    dash["B8"] = (
        '=IF(B6<0,"OVER BUDGET — stop discretionary spend",'
        'IF(B7>D7+0.05,"Spending faster than the month — slow down",'
        'IF(B7>D7,"Slightly ahead of pace — be careful","On track")))'
    )
    dash["B8"].font = warn_font
    dash["B8"].fill = alert_fill
    dash["B8"].border = thin
    dash.merge_cells("B8:D8")

    dash["A9"] = (
        "Tip: Safe ₹/day = budget remaining ÷ days left (incl. today). "
        "If used % > month elapsed %, you are burning budget too fast."
    )
    dash["A9"].font = muted_font
    dash.merge_cells("A9:D9")

    # ── UPCOMING CREDIT CARD BILLS ─────────────────────────────────────
    _section(dash, "A11", "UPCOMING CREDIT CARD BILLS", "D11")

    _label(dash["A12"], "HDFC Credit Card")
    money_cell(dash["B12"], formula=_form_balance_for_label("A12"))
    dash["C12"] = "outstanding due"
    dash["C12"].font = muted_font

    _label(dash["A13"], "ICICI Credit Card")
    money_cell(dash["B13"], formula=_form_balance_for_label("A13"))
    dash["C13"] = "outstanding due"
    dash["C13"].font = muted_font

    _label(dash["A14"], "Total CC due", bold=True)
    money_cell(dash["B14"], formula=_FORM_CC_DUE, fill=alert_fill)
    dash["B14"].font = Font(bold=True, size=12)
    dash["C14"] = "every Configuration account with Group=Credit Card"
    dash["C14"].font = muted_font

    dash["A15"] = "Pay from savings before treating anything as free to allocate."
    dash["A15"].font = muted_font
    dash.merge_cells("A15:D15")

    # ── FREE TO ALLOCATE (liquid − budget reserved − committed) ────────
    _section(dash, "A17", "FREE TO ALLOCATE — after budget, bills, near-term plans", "D17")

    _label(dash["A18"], "Total liquid savings")
    money_cell(dash["B18"], formula=_FORM_LIQUID)
    dash["C18"] = "Configuration Include in Liquid Cash"
    dash["C18"].font = muted_font

    _label(dash["A19"], "Budget still reserved")
    money_cell(dash["B19"], formula="=MAX(0,B6)")
    dash["C19"] = "discretionary envelope still unused this month"
    dash["C19"].font = muted_font

    _label(dash["A20"], "Committed cash", bold=True)
    money_cell(dash["B20"], formula=_form_committed_cash("B14"), fill=alert_fill)
    dash["B20"].font = Font(bold=True, size=12)
    dash["C20"] = "CC due + remaining EMI this month + one-time (30d)"
    dash["C20"].font = muted_font

    _label(dash["A21"], "Free to allocate", bold=True)
    money_cell(
        dash["B21"],
        formula=_form_free_less_committed("B18", "B19", "B20"),
        fill=good_fill,
    )
    dash["B21"].font = Font(name="Calibri", size=16, bold=True, color="1F4E79")
    dash["C21"] = "liquid − budget reserved − committed"
    dash["C21"].font = muted_font

    dash["A22"] = (
        "Budget remaining is the unused discretionary cap. Committed cash is CC due, "
        "remaining Loan/EMI this month (not in that cap), and Planned one-time in the next 30 days. "
        "Rent/family already inside Include in Budget are not added again."
    )
    dash["A22"].font = muted_font
    dash.merge_cells("A22:D22")
    dash.row_dimensions[22].height = 36

    # ── NEXT MONTH FREE-TO-ALLOCATE (estimate) ─────────────────────────
    _section(dash, "A24", "NEXT MONTH FREE-TO-ALLOCATE — estimate", "D24")

    _label(dash["A25"], "Free to allocate (today)")
    money_cell(dash["B25"], formula="=B21")
    dash["C25"] = "starting point (already nets CC + this month's remaining EMI + 30d)"
    dash["C25"].font = muted_font

    _label(dash["A26"], "− Next month Loan / EMI")
    money_cell(dash["B26"], formula=_FORM_NEXT_MONTH_EMI)
    dash["C26"] = "outside the monthly budget cap"
    dash["C26"].font = muted_font

    _label(dash["A27"], "+ Monthly salary")
    money_cell(dash["B27"], formula="=Configuration!B7")
    dash["C27"] = "from Configuration (edit yellow cell)"
    dash["C27"].font = muted_font

    _label(dash["A28"], "− Next month budget")
    money_cell(dash["B28"], formula=_FORM_NEXT_MONTH_BUDGET)
    dash["C28"] = "reserved for next month's spend cap"
    dash["C28"].font = muted_font

    _label(dash["A29"], "Est. free next month", bold=True)
    money_cell(dash["B29"], formula="=B25-B26+B27-B28", fill=soft_fill)
    dash["B29"].font = Font(name="Calibri", size=16, bold=True, color="1F4E79")
    dash["C29"] = "after next EMI + salary + next budget"
    dash["C29"].font = muted_font

    dash["A30"] = (
        "Estimate = free today − next month's EMI + monthly salary − next month's budget. "
        "Today's free already reserves CC due, this month's remaining EMI, and 30-day one-time plans. "
        "If this month's salary is already in liquid savings, it is already counted — "
        "use Configuration monthly salary as take-home you expect to receive for the next cycle."
    )
    dash["A30"].font = muted_font
    dash.merge_cells("A30:D30")
    dash.row_dimensions[30].height = 48

    # ── PLANNED EXPENSES (planning only) ───────────────────────────────
    pe_end = _add_planned_summary_block(dash, 32, cols="D")
    _add_commitment_forecast_block(dash, pe_end + 2, cols="E")

    for col_letter, w in zip(list("ABCD"), [28, 16, 40, 14]):
        dash.column_dimensions[col_letter].width = w
    dash.row_dimensions[8].height = 22
    dash.freeze_panes = "A4"


def populate_detailed_dashboard(dash, n_accounts: int | None = None) -> None:
    """Fill Detailed Dashboard: pace cards, balances, net worth, 3 charts."""
    if n_accounts is None:
        n_accounts = len(ACCOUNTS)

    _clear_sheet(dash, max_row=60, max_col=12)

    dash["A1"] = "DETAILED DASHBOARD"
    dash["A1"].font = title_font
    dash["A2"] = (
        "Full snapshot + charts. Day-to-day numbers live on Simple Dashboard. "
        "Reload after phone saves."
    )
    dash["A2"].font = muted_font
    dash.merge_cells("A2:F2")

    # ── PACE / BE CAREFUL ──────────────────────────────────────────────
    _section(dash, "A4", "PACE — BE CAREFUL", "F4")

    _label(dash["A5"], "Month")
    dash["B5"] = '=TEXT(TODAY(),"MMMM YYYY")'
    dash["B5"].font = Font(bold=True, size=12, color="1F4E79")
    dash["B5"].border = thin

    _label(dash["C5"], "Days left in month")
    # Include today in remaining so "1 day left" on last day still shows budget/day.
    # Force integer format — LibreOffice otherwise shows the day-count as a date (e.g. 25/01/00).
    dash["D5"] = "=EOMONTH(TODAY(),0)-TODAY()+1"
    dash["D5"].font = big_num_font
    dash["D5"].fill = soft_fill
    dash["D5"].border = thin
    dash["D5"].number_format = "0"
    dash["D5"].alignment = Alignment(horizontal="center")

    _label(dash["E5"], "Days elapsed")
    dash["F5"] = "=DAY(TODAY())"
    dash["F5"].fill = calc_fill
    dash["F5"].border = thin
    dash["F5"].number_format = "0"
    dash["F5"].alignment = Alignment(horizontal="center")

    _label(dash["A6"], "Monthly Budget")
    money_cell(dash["B6"], formula="='Monthly Budget'!B6")

    _label(dash["C6"], "Budget remaining", bold=True)
    money_cell(dash["D6"], formula="='Monthly Budget'!B9", fill=good_fill)
    dash["D6"].font = big_num_font

    _label(dash["E6"], "Budget spent")
    money_cell(dash["F6"], formula="='Monthly Budget'!B8")

    _label(dash["A7"], "Safe to spend / day left", bold=True)
    money_cell(
        dash["B7"],
        formula='=IF(D5<=0,0,MAX(0,D6)/D5)',
        fill=soft_fill,
    )
    dash["B7"].font = big_num_font

    _label(dash["C7"], "Budget used %")
    dash["D7"] = "='Monthly Budget'!B16"
    dash["D7"].number_format = pct
    dash["D7"].fill = calc_fill
    dash["D7"].border = thin

    _label(dash["E7"], "Month elapsed %")
    dash["F7"] = "=DAY(TODAY())/DAY(EOMONTH(TODAY(),0))"
    dash["F7"].number_format = pct
    dash["F7"].fill = calc_fill
    dash["F7"].border = thin

    _label(dash["A8"], "Pace check", bold=True)
    dash["B8"] = (
        '=IF(D6<0,"OVER BUDGET — stop discretionary spend",'
        'IF(D7>F7+0.05,"Spending faster than the month — slow down",'
        'IF(D7>F7,"Slightly ahead of pace — be careful","On track")))'
    )
    dash["B8"].font = warn_font
    dash["B8"].fill = alert_fill
    dash["B8"].border = thin
    dash.merge_cells("B8:F8")

    dash["A9"] = (
        "Tip: Safe ₹/day = budget remaining ÷ days left (including today). "
        "If used % is above month elapsed %, you are burning budget too fast."
    )
    dash["A9"].font = muted_font
    dash.merge_cells("A9:F9")

    # ── THIS MONTH snapshot ────────────────────────────────────────────
    _section(dash, "A11", "THIS MONTH", "B11")
    for label, formula, r, is_pct in [
        ("Income", "='Monthly Budget'!B7", 12, False),
        ("Budget Expenses", "='Monthly Budget'!B8", 13, False),
        ("Non-Budget Expenses", "='Monthly Budget'!B10", 14, False),
        ("Est. Savings", "='Monthly Budget'!B15", 15, False),
        ("Investments", "='Monthly Budget'!B11", 16, False),
        ("EMIs + Rent", "='Monthly Budget'!B12+'Monthly Budget'!B13", 17, False),
    ]:
        _label(dash.cell(r, 1), label)
        if is_pct:
            dash.cell(r, 2, formula)
            dash.cell(r, 2).number_format = pct
            dash.cell(r, 2).fill = calc_fill
            dash.cell(r, 2).border = thin
        else:
            money_cell(dash.cell(r, 2), formula=formula)

    # ── CREDIT CARDS (upcoming bills) ──────────────────────────────────
    _section(dash, "D11", "UPCOMING CREDIT CARD BILLS", "F11")
    dash["D12"] = "HDFC Credit Card"
    dash["D12"].font = Font(bold=True)
    _label(dash["D13"], "Outstanding")
    money_cell(dash["E13"], formula=_form_balance_for_label("D12"))
    _label(dash["D14"], "Limit / Available")
    money_cell(dash["E14"], formula=_form_limit_for_label("D12"))
    money_cell(dash["F14"], formula="=E14-E13")
    _label(dash["D15"], "Utilization")
    dash["E15"] = "=IF(E14=0,0,E13/E14)"
    dash["E15"].number_format = pct
    dash["E15"].fill = calc_fill
    dash["E15"].border = thin

    dash["D16"] = "ICICI Credit Card"
    dash["D16"].font = Font(bold=True)
    _label(dash["D17"], "Outstanding")
    money_cell(dash["E17"], formula=_form_balance_for_label("D16"))
    _label(dash["D18"], "Limit / Available")
    money_cell(dash["E18"], formula=_form_limit_for_label("D16"))
    money_cell(dash["F18"], formula="=E18-E17")
    _label(dash["D19"], "Utilization")
    dash["E19"] = "=IF(E18=0,0,E17/E18)"
    dash["E19"].number_format = pct
    dash["E19"].fill = calc_fill
    dash["E19"].border = thin

    _label(dash["D20"], "Total CC due", bold=True)
    money_cell(dash["E20"], formula=_FORM_CC_DUE, fill=alert_fill)
    dash["E20"].font = Font(bold=True, size=12)

    # ── FREE TO ALLOCATE ───────────────────────────────────────────────
    _section(dash, "A19", "FREE TO ALLOCATE — after budget, bills, near-term plans", "B19")
    _label(dash["A20"], "Total liquid savings")
    money_cell(dash["B20"], formula=_FORM_LIQUID)
    _label(dash["A21"], "Budget still reserved")
    money_cell(dash["B21"], formula="=MAX(0,D6)")
    _label(dash["A22"], "Free to allocate", bold=True)
    money_cell(
        dash["B22"],
        formula=_form_free_detailed(liquid="B20", budget="B21", cc="E20"),
        fill=good_fill,
    )
    dash["B22"].font = Font(name="Calibri", size=14, bold=True, color="1F4E79")

    # ── NEXT MONTH FREE-TO-ALLOCATE (estimate) ─────────────────────────
    _section(dash, "D22", "NEXT MONTH FREE-TO-ALLOCATE — estimate", "F22")
    _label(dash["D23"], "Free to allocate (today)")
    money_cell(dash["E23"], formula="=B22")
    _label(dash["D24"], "− Next month Loan / EMI")
    money_cell(dash["E24"], formula=_FORM_NEXT_MONTH_EMI)
    _label(dash["D25"], "+ Monthly salary")
    money_cell(dash["E25"], formula="=Configuration!B7")
    _label(dash["D26"], "− Next month budget")
    money_cell(dash["E26"], formula=_FORM_NEXT_MONTH_BUDGET)
    _label(dash["D27"], "Est. free next month", bold=True)
    money_cell(dash["E27"], formula="=E23-E24+E25-E26", fill=soft_fill)
    dash["E27"].font = Font(name="Calibri", size=14, bold=True, color="1F4E79")

    dash["A23"] = (
        "Free to allocate = liquid − budget remaining − CC due − remaining EMI "
        "this month − Planned one-time (30d). Rent/family inside the budget cap "
        "are not subtracted twice. Next-month estimate = free today − next EMI "
        "+ salary − next budget. Set Monthly Salary on Configuration."
    )
    dash["A23"].font = muted_font
    dash.merge_cells("A23:B27")
    dash.row_dimensions[23].height = 48

    # ── ACCOUNT BALANCES + NET WORTH ───────────────────────────────────
    bal_section = 29
    _section(dash, f"A{bal_section}", "ACCOUNT BALANCES", f"B{bal_section}")
    dash.cell(bal_section + 1, 1, "Account")
    dash.cell(bal_section + 1, 2, "Balance / Due")
    style_header_row(dash, bal_section + 1, 1, 2)
    bal_start = bal_section + 2
    for i in range(n_accounts):
        r = bal_start + i
        rec_r = 5 + i
        dash.cell(r, 1, f"=Reconciliation!A{rec_r}").border = thin
        money_cell(dash.cell(r, 2), formula=f"=Reconciliation!C{rec_r}")
    bal_end = bal_start + n_accounts - 1

    _section(dash, f"D{bal_section}", "NET WORTH", f"F{bal_section}")
    _label(dash.cell(bal_section + 1, 4), "Savings & Cash")
    money_cell(dash.cell(bal_section + 1, 5), formula=_FORM_LIQUID)
    _label(dash.cell(bal_section + 2, 4), "FD")
    money_cell(dash.cell(bal_section + 2, 5), formula=_FORM_FD)
    _label(dash.cell(bal_section + 3, 4), "Investments")
    money_cell(dash.cell(bal_section + 3, 5), formula=_FORM_INVESTMENTS)
    _label(dash.cell(bal_section + 4, 4), "Total Assets")
    money_cell(dash.cell(bal_section + 4, 5), formula=_FORM_NW_ASSETS)
    dash.cell(bal_section + 4, 5).font = Font(bold=True)
    _label(dash.cell(bal_section + 5, 4), "Liabilities")
    money_cell(dash.cell(bal_section + 5, 5), formula=_FORM_NW_LIABILITIES)
    _label(dash.cell(bal_section + 6, 4), "NET WORTH", bold=True)
    money_cell(
        dash.cell(bal_section + 6, 5),
        formula=f"=E{bal_section + 4}-E{bal_section + 5}",
        fill=good_fill,
    )
    dash.cell(bal_section + 6, 5).font = Font(bold=True, size=14, color="1F4E79")

    # ── CHART DATA (right side, narrow — still visible for transparency) ─
    # Budget burn doughnut source
    dash["H4"] = "CHART DATA"
    dash["H4"].font = section_font
    dash["H4"].fill = section_fill
    dash.merge_cells("H4:I4")
    dash["H5"] = "Budget slice"
    dash["I5"] = "Amount"
    style_header_row(dash, 5, 8, 9)
    dash["H6"] = "Spent"
    money_cell(dash["I6"], formula="=MAX(0,F6)")
    dash["H7"] = "Remaining"
    money_cell(dash["I7"], formula="=MAX(0,D6)")
    dash["H8"] = "(Over budget ignored in pie; see pace check)"
    dash["H8"].font = muted_font
    dash.merge_cells("H8:I8")

    # Last 6 months income vs budget expenses
    dash["H10"] = "Last 6 months"
    dash["H10"].font = section_font
    dash["H10"].fill = section_fill
    dash.merge_cells("H10:J10")
    dash["H11"] = "Month"
    dash["I11"] = "Income"
    dash["J11"] = "Budget Exp"
    style_header_row(dash, 11, 8, 10)
    for i in range(6):
        r = 12 + i
        # i=0 → 5 months ago … i=5 → current month
        offset = i - 5
        dash.cell(
            r,
            8,
            f'=TEXT(EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),{offset}),"mmm yy")',
        ).border = thin
        money_cell(
            dash.cell(r, 9),
            formula=(
                f'=SUMIFS(Ledger!$G:$G,Ledger!$D:$D,'
                f'TEXT(EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),{offset}),"MMMM"),'
                f'Ledger!$E:$E,YEAR(EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),{offset})),'
                f'Ledger!$F:$F,"Income")'
            ),
        )
        money_cell(
            dash.cell(r, 10),
            formula=(
                f'=SUMIFS(Ledger!$G:$G,Ledger!$D:$D,'
                f'TEXT(EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),{offset}),"MMMM"),'
                f'Ledger!$E:$E,YEAR(EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),{offset})),'
                f'Ledger!$F:$F,"Expense",Ledger!$K:$K,TRUE())'
                f'-SUMIFS(Ledger!$G:$G,Ledger!$D:$D,'
                f'TEXT(EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),{offset}),"MMMM"),'
                f'Ledger!$E:$E,YEAR(EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),{offset})),'
                f'Ledger!$F:$F,"Refund",Ledger!$K:$K,TRUE())'
            ),
        )

    # Category spend this month (budget expenses by category)
    dash["H19"] = "Spend by category (this month)"
    dash["H19"].font = section_font
    dash["H19"].fill = section_fill
    dash.merge_cells("H19:I19")
    dash["H20"] = "Category"
    dash["I20"] = "Spent"
    style_header_row(dash, 20, 8, 9)
    chart_cats = list(CHART_CATEGORIES)
    for i, cat in enumerate(chart_cats):
        r = 21 + i
        dash.cell(r, 8, cat).border = thin
        money_cell(
            dash.cell(r, 9),
            formula=(
                f'=SUMIFS(Ledger!$G:$G,Ledger!$D:$D,TEXT(TODAY(),"MMMM"),'
                f'Ledger!$E:$E,YEAR(TODAY()),Ledger!$F:$F,"Expense",'
                f'Ledger!$J:$J,H{r})'
                f'-SUMIFS(Ledger!$G:$G,Ledger!$D:$D,TEXT(TODAY(),"MMMM"),'
                f'Ledger!$E:$E,YEAR(TODAY()),Ledger!$F:$F,"Refund",'
                f'Ledger!$J:$J,H{r})'
            ),
        )
    cat_end = 20 + len(chart_cats)

    # ── CHARTS ─────────────────────────────────────────────────────────
    # 1) Budget burn doughnut
    pie = DoughnutChart()
    pie.title = "Budget: spent vs remaining"
    labels = Reference(dash, min_col=8, min_row=6, max_row=7)
    data = Reference(dash, min_col=9, min_row=5, max_row=7)
    pie.add_data(data, titles_from_data=True)
    pie.set_categories(labels)
    pie.dataLabels = DataLabelList()
    pie.dataLabels.showPercent = True
    pie.dataLabels.showVal = False
    pie.dataLabels.showCatName = True
    pie.style = 10
    pie.width = 12
    pie.height = 8
    # series colors: spent=coral, remaining=green
    try:
        s = pie.series[0]
        pt0 = DataPoint(idx=0)
        pt0.graphicalProperties = GraphicalProperties(
            solidFill="E57373"
        )
        pt1 = DataPoint(idx=1)
        pt1.graphicalProperties = GraphicalProperties(
            solidFill="66BB6A"
        )
        s.data_points = [pt0, pt1]
    except Exception:
        pass
    dash.add_chart(pie, "A35")

    # 2) 6-month income vs expenses
    col = BarChart()
    col.type = "col"
    col.grouping = "clustered"
    col.title = "Last 6 months: income vs budget spend"
    col.y_axis.title = "₹"
    col.x_axis.title = None
    data2 = Reference(dash, min_col=9, min_row=11, max_col=10, max_row=17)
    cats2 = Reference(dash, min_col=8, min_row=12, max_row=17)
    col.add_data(data2, titles_from_data=True)
    col.set_categories(cats2)
    col.shape = 4
    col.style = 10
    col.width = 15
    col.height = 9
    dash.add_chart(col, "D35")

    # 3) Category bars
    bar = BarChart()
    bar.type = "bar"
    bar.style = 10
    bar.title = "This month — where budget spend went"
    bar.y_axis.title = None
    data3 = Reference(dash, min_col=9, min_row=20, max_row=cat_end)
    cats3 = Reference(dash, min_col=8, min_row=21, max_row=cat_end)
    bar.add_data(data3, titles_from_data=True)
    bar.set_categories(cats3)
    bar.shape = 4
    bar.width = 15
    bar.height = 10
    dash.add_chart(bar, "A52")

    # Quick legend under charts area notes
    note_row = bal_end + 2
    if note_row < 34:
        note_row = 34
    dash.cell(note_row, 1, "Charts sit below · Chart source tables in columns H–J")
    dash.cell(note_row, 1).font = muted_font

    # Planned Expenses summary (below balances/charts note — planning only)
    pe_row = max(note_row + 2, 45)
    pe_end = _add_planned_summary_block(dash, pe_row, cols="F")
    # Category chart sits around rows 55–73; keep the 6-month table below it.
    _add_commitment_forecast_block(dash, max(pe_end + 2, 75), cols="E")

    for col_letter, w in zip(
        list("ABCDEFGHIJ"), [26, 16, 22, 18, 16, 14, 3, 22, 12, 12]
    ):
        dash.column_dimensions[col_letter].width = w
    dash.row_dimensions[8].height = 22
    dash.freeze_panes = "A4"


def build() -> Path:
    wb = Workbook()
    cfg = wb.active
    cfg.title = "Configuration"

    # ── Configuration ──────────────────────────────────────────────────
    cfg["A1"] = "CONFIGURATION"
    cfg["A1"].font = title_font
    cfg["A2"] = (
        "Edit only yellow cells. Everything else is derived from the Ledger. "
        "Do not store current balances here — only opening balances and credit limits."
    )
    cfg["A2"].font = muted_font
    cfg.merge_cells("A2:H2")

    cfg["A4"] = "BUDGET DEFAULT"
    cfg["A4"].font = section_font
    cfg["A4"].fill = section_fill
    cfg.merge_cells("A4:C4")
    cfg["A5"] = "Setting"
    cfg["B5"] = "Value"
    cfg["C5"] = "Notes"
    style_header_row(cfg, 5, 1, 3)
    cfg["A6"] = "Default Monthly Budget (₹)"
    money_cell(cfg["B6"], value=10000, editable=True)
    cfg["C6"] = "Override per month on Monthly Budget sheet"
    cfg["A7"] = "Monthly Salary (₹)"
    money_cell(cfg["B7"], value=0, editable=True)
    cfg["C7"] = "Take-home used for next-month free-to-allocate estimate on dashboards"

    cfg["A8"] = "ACCOUNTS"
    cfg["A8"].font = section_font
    cfg["A8"].fill = section_fill
    cfg.merge_cells("A8:H8")
    cfg["A9"] = (
        "Every ledger entry moves money From Account → To Account. "
        "Opening Balance is the starting point only. "
        "Dashboards SUMIFS Include in Liquid Cash / Include in Net Worth / Account Group."
    )
    cfg["A9"].font = muted_font
    cfg.merge_cells("A9:H9")

    for i, h in enumerate(
        [
            "Account",
            "Type",
            "Opening Balance (₹)",
            "Credit Limit (₹)",
            "Include in Net Worth",
            "Include in Liquid Cash",
            "Account Group",
            "Notes",
        ],
        1,
    ):
        cfg.cell(CFG_ACC_HEADER_ROW, i, h)
    style_header_row(cfg, CFG_ACC_HEADER_ROW, 1, 8)

    ACC_START = CFG_ACC_START
    for i, (name, typ, opening, limit, nw, liquid, group, notes) in enumerate(ACCOUNTS):
        r = ACC_START + i
        _write_config_account_row(
            cfg,
            r,
            name=name,
            typ=typ,
            opening=opening,
            limit=limit,
            nw=nw,
            liquid=liquid,
            group=group,
            notes=notes,
        )
    named_end = ACC_START + len(ACCOUNTS) - 1
    ACC_END = named_end + CFG_ACC_EXTRA_ROWS
    for r in range(named_end + 1, ACC_END + 1):
        _style_config_account_row(cfg, r)

    cfg["J8"] = "LEDGER TYPES"
    cfg["J8"].font = section_font
    cfg["J8"].fill = section_fill
    cfg["J9"] = "Type"
    cfg["J9"].font = header_font
    cfg["J9"].fill = header_fill
    for i, t in enumerate(TYPES):
        cfg.cell(10 + i, 10, t).fill = yellow_fill
        cfg.cell(10 + i, 10).border = thin
    TYPE_END = 10 + len(TYPES) - 1

    guides = [
        ("Income", "From=Employer → To=bank/cash. Budget=FALSE."),
        ("Expense", "From=account/card → To=Expense. Budget=TRUE for normal spends."),
        ("Transfer", "Between your accounts. Budget=FALSE."),
        ("Credit Card Payment", "From=savings → To=credit card. Budget=FALSE."),
        ("Refund", "From=Expense → To=account/card."),
        ("Investment", "From=savings → To=FD / Mutual Fund. Budget=FALSE."),
        ("Adjustment", "Reconciliation catch-up. Keeps ledger as source of truth."),
    ]
    cfg["K8"] = "TYPE GUIDE"
    cfg["K8"].font = section_font
    cfg["L9"] = "From → To pattern"
    cfg["K9"] = "Type"
    style_header_row(cfg, 9, 11, 12)
    for i, (t, g) in enumerate(guides):
        cfg.cell(10 + i, 11, t).border = thin
        cfg.cell(10 + i, 12, g).border = thin

    cat_header_row = ACC_END + 3
    cfg.cell(cat_header_row, 1, "CATEGORIES")
    cfg.cell(cat_header_row, 1).font = section_font
    cfg.cell(cat_header_row, 1).fill = section_fill
    cfg.merge_cells(
        start_row=cat_header_row, start_column=1, end_row=cat_header_row, end_column=3
    )
    cfg.cell(cat_header_row + 1, 1).value = (
        "Add new rows under the list (yellow). Group helps review. "
        "Typical Budget? = default for phone form / new Ledger rows — override per entry."
    )
    cfg.cell(cat_header_row + 1, 1).font = muted_font
    cfg.merge_cells(
        start_row=cat_header_row + 1,
        start_column=1,
        end_row=cat_header_row + 1,
        end_column=3,
    )
    cfg.cell(cat_header_row + 2, 1, "Category")
    cfg.cell(cat_header_row + 2, 2, "Group")
    cfg.cell(cat_header_row + 2, 3, "Typical Budget?")
    style_header_row(cfg, cat_header_row + 2, 1, 3)
    CAT_START = cat_header_row + 3
    for i, (cat, group, bud) in enumerate(CATEGORIES):
        r = CAT_START + i
        cfg.cell(r, 1, cat).fill = yellow_fill
        cfg.cell(r, 1).border = thin
        cfg.cell(r, 2, group).fill = yellow_fill
        cfg.cell(r, 2).border = thin
        cfg.cell(r, 3, "TRUE" if bud else "FALSE").fill = yellow_fill
        cfg.cell(r, 3).border = thin
    CAT_END = CAT_START + len(CATEGORIES) - 1
    # Extra blank yellow rows so you can add varieties without rebuilding
    EXTRA_CAT_ROWS = 15
    for r in range(CAT_END + 1, CAT_END + 1 + EXTRA_CAT_ROWS):
        for c in (1, 2, 3):
            cfg.cell(r, c).fill = yellow_fill
            cfg.cell(r, c).border = thin
    CAT_DV_END = CAT_END + EXTRA_CAT_ROWS

    rules_header = CAT_DV_END + 2
    cfg.cell(rules_header, 1, "RULES").font = section_font
    cfg.cell(rules_header, 1).fill = section_fill
    rules = [
        "1. Enter every money movement exactly once in the Ledger. Never edit calculated balances.",
        "2. From Account / To Account replace Payment Method + Credit Card.",
        "3. Amount is always positive. Direction is entirely From → To.",
        "4. Include in Budget = TRUE only for normal monthly spends under the budget cap.",
        "5. Rent, EMI, salary, transfers, investments, CC bill payments → usually Budget = FALSE.",
        "6. Opening balances on this sheet are the ONLY manual balance inputs (starting point).",
        "7. When calculated ≠ bank app, use Reconciliation → add missing Ledger row or Adjustment.",
        "8. Asset = Opening + To − From. Liability due = Opening + From − To.",
        "9. Prefer a specific category over Other — it makes Dashboard / review much easier.",
        "10. To add a category: type it in the next blank yellow row (Group + Typical Budget?). Phone form reads Configuration.",
        "11. To add an account: fill the next blank yellow row (Type, opening, Net Worth, Liquid Cash, Account Group). Dashboards SUMIFS those flags — do not insert a row in the middle of the list.",
    ]
    for i, rule in enumerate(rules):
        rr = rules_header + 1 + i
        cfg.cell(rr, 1, rule)
        cfg.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=8)

    dv_acc_type = DataValidation(
        type="list", formula1='"Asset,Liability,Virtual"', allow_blank=True
    )
    dv_acc_bool = DataValidation(type="list", formula1='"TRUE,FALSE"', allow_blank=True)
    dv_acc_group = DataValidation(
        type="list",
        formula1='"' + ",".join(ACCOUNT_GROUPS) + '"',
        allow_blank=True,
    )
    for dv in (dv_acc_type, dv_acc_bool, dv_acc_group):
        cfg.add_data_validation(dv)
    dv_acc_type.add(f"B{ACC_START}:B{ACC_END}")
    dv_acc_bool.add(f"E{ACC_START}:F{ACC_END}")
    dv_acc_group.add(f"G{ACC_START}:G{ACC_END}")

    for col, w in zip(
        list("ABCDEFGHJKL"), [28, 14, 18, 18, 20, 22, 16, 36, 22, 22, 70]
    ):
        cfg.column_dimensions[col].width = w

    # ── Ledger ─────────────────────────────────────────────────────────
    led = wb.create_sheet("Ledger")
    headers = [
        "Date",
        "Time",
        "Day",
        "Month",
        "Year",
        "Type",
        "Amount (₹)",
        "From Account",
        "To Account",
        "Category",
        "Include in Budget",
        "Notes",
        "Source",  # manual (form) | ai (voice LLM)
    ]
    for i, h in enumerate(headers, 1):
        led.cell(1, i, h)
    style_header_row(led, 1, 1, 13)
    led.row_dimensions[1].height = 30
    led.freeze_panes = "A2"

    samples = [
        (46240.0, 0.4409722222222222, "Expense", 35.0, "HDFC Savings", "Expense", "Eating outside", True, "Local food stall", "manual"),
        (46240.0, 0.45416666666666666, "Expense", 18.0, "HDFC Savings", "Expense", "Groceries - Physical", True, "Akshayakalpa milk", "manual"),
    ]
    for i, (dt_s, tm, typ, amt, fr, to, cat, bud, notes, src) in enumerate(samples):
        r = 2 + i
        led.cell(r, 1, dt_s).number_format = "dd/mm/yyyy"
        led.cell(r, 1).fill = yellow_fill
        led.cell(r, 2, tm).number_format = "HH:mm"
        led.cell(r, 2).fill = yellow_fill
        led.cell(r, 3, f'=IF(A{r}="","",TEXT(A{r},"dddd"))')
        led.cell(r, 4, f'=IF(A{r}="","",TEXT(A{r},"MMMM"))')
        led.cell(r, 5, f'=IF(A{r}="","",YEAR(A{r}))')
        led.cell(r, 6, typ).fill = yellow_fill
        money_cell(led.cell(r, 7), value=amt, editable=True)
        led.cell(r, 8, fr).fill = yellow_fill
        led.cell(r, 9, to).fill = yellow_fill
        led.cell(r, 10, cat).fill = yellow_fill
        led.cell(r, 11, "=TRUE()" if bud else "=FALSE()").fill = yellow_fill
        led.cell(r, 12, notes).fill = yellow_fill
        led.cell(r, 13, src).fill = yellow_fill
        for c in range(1, 14):
            led.cell(r, c).border = thin

    for r in range(4, LEDGER_PREFILL_LAST_ROW + 1):
        _prefill_ledger_empty_row(led, r)

    dv_type = DataValidation(
        type="list", formula1=f"Configuration!$J$10:$J${TYPE_END}", allow_blank=True
    )
    dv_acc = DataValidation(
        type="list", formula1=f"Configuration!$A${ACC_START}:$A${ACC_END}", allow_blank=True
    )
    dv_cat = DataValidation(
        type="list",
        formula1=f"Configuration!$A${CAT_START}:$A${CAT_DV_END}",
        allow_blank=True,
    )
    dv_bool = DataValidation(type="list", formula1='"TRUE,FALSE"', allow_blank=True)
    dv_source = DataValidation(type="list", formula1='"manual,ai"', allow_blank=True)
    for dv in (dv_type, dv_acc, dv_cat, dv_bool, dv_source):
        led.add_data_validation(dv)
    dv_end = LEDGER_PREFILL_LAST_ROW
    dv_type.add(f"F2:F{dv_end}")
    dv_acc.add(f"H2:H{dv_end}")
    dv_acc.add(f"I2:I{dv_end}")
    dv_cat.add(f"J2:J{dv_end}")
    dv_bool.add(f"K2:K{dv_end}")
    dv_source.add(f"M2:M{dv_end}")
    led.auto_filter.ref = f"A1:M{dv_end}"

    for col, w in zip(
        list("ABCDEFGHIJKLM"), [12, 8, 12, 12, 8, 20, 12, 18, 18, 22, 16, 28, 10]
    ):
        led.column_dimensions[col].width = w

    # ── Monthly Budget ─────────────────────────────────────────────────
    mb = wb.create_sheet("Monthly Budget")
    mb["A1"] = "MONTHLY BUDGET"
    mb["A1"].font = title_font
    mb["A2"] = (
        "Only the Budget column is manual (yellow). All other figures come from the Ledger."
    )
    mb["A2"].font = muted_font
    mb.merge_cells("A2:L2")

    mb["A4"] = "THIS MONTH"
    mb["A4"].font = section_font
    mb["A4"].fill = section_fill
    mb["A5"] = "Month"
    mb["B5"] = '=TEXT(TODAY(),"MMMM YYYY")'
    mb["B5"].font = Font(bold=True, size=14, color="1F4E79")

    L = "Ledger"
    mb["A6"] = "Budget"
    money_cell(
        mb["B6"],
        formula=_FORM_THIS_MONTH_BUDGET,
    )
    rows_snap = [
        (
            "Income / Salary",
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(TODAY(),"MMMM"),{L}!$E:$E,YEAR(TODAY()),{L}!$F:$F,"Income")',
        ),
        (
            "Budget Expenses",
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(TODAY(),"MMMM"),{L}!$E:$E,YEAR(TODAY()),{L}!$F:$F,"Expense",{L}!$K:$K,TRUE)'
            f'-SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(TODAY(),"MMMM"),{L}!$E:$E,YEAR(TODAY()),{L}!$F:$F,"Refund",{L}!$K:$K,TRUE)',
        ),
        ("Remaining Budget", "=B6-B8"),
        (
            "Non-Budget Expenses",
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(TODAY(),"MMMM"),{L}!$E:$E,YEAR(TODAY()),{L}!$F:$F,"Expense",{L}!$K:$K,FALSE)',
        ),
        (
            "Investments",
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(TODAY(),"MMMM"),{L}!$E:$E,YEAR(TODAY()),{L}!$F:$F,"Investment")',
        ),
        (
            "EMIs",
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(TODAY(),"MMMM"),{L}!$E:$E,YEAR(TODAY()),{L}!$J:$J,"EMIs")',
        ),
        (
            "Rent",
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(TODAY(),"MMMM"),{L}!$E:$E,YEAR(TODAY()),{L}!$J:$J,"Rent")',
        ),
        (
            "CC Payments",
            f'=SUMIFS({L}!$G:$G,{L}!$D:$D,TEXT(TODAY(),"MMMM"),{L}!$E:$E,YEAR(TODAY()),{L}!$F:$F,"Credit Card Payment")',
        ),
        ("Est. Savings (Income − outflows)", "=B7-B8-B10-B11"),
    ]
    for i, (label, formula) in enumerate(rows_snap):
        r = 7 + i
        mb.cell(r, 1, label).border = thin
        money_cell(mb.cell(r, 2), formula=formula)
    mb["B9"].fill = good_fill
    mb["A16"] = "Budget used %"
    mb["B16"] = "=IF(B6=0,0,B8/B6)"
    mb["B16"].number_format = pct
    mb["B16"].fill = calc_fill
    mb["B16"].border = thin

    mb["A18"] = (
        "MONTH-BY-MONTH — only Budget (col B) is editable. "
        "Derived columns are formulas. Table MonthlyBudget: add a row at the bottom to extend."
    )
    mb["A18"].font = section_font
    mb["A18"].fill = section_fill
    mb.merge_cells("A18:L18")
    for i, h in enumerate(
        [
            "Month Start",
            "Budget",
            "Income",
            "Budget Expenses",
            "Remaining",
            "Non-Budget Exp",
            "Investments",
            "EMIs",
            "Rent",
            "CC Payments",
            "Est. Savings",
            "Label",
        ],
        1,
    ):
        mb.cell(19, i, h)
    style_header_row(mb, 19, 1, 12)

    start = ddate(2026, 1, 1)
    n_months = (
        (MB_GRID_END.year - start.year) * 12
        + (MB_GRID_END.month - start.month)
        + 1
    )
    for i in range(n_months):
        r = MB_FIRST_DATA_ROW + i
        _write_monthly_budget_month_row(mb, r, _add_calendar_months(start, i), 10000)
    _ensure_monthly_budget_table(mb, MB_FIRST_DATA_ROW + n_months - 1)

    for col, w in zip(list("ABCDEFGHIJKL"), [12, 12, 12, 15, 12, 14, 12, 10, 10, 12, 12, 14]):
        mb.column_dimensions[col].width = w

    # ── Reconciliation ─────────────────────────────────────────────────
    rec = wb.create_sheet("Reconciliation")
    rec["A1"] = "ACCOUNT RECONCILIATION"
    rec["A1"].font = title_font
    rec["A2"] = (
        "Calculated balance always comes from Opening + Ledger. Enter Actual only when you check "
        "your bank/app. If Difference ≠ 0: find the missing txn, or add Type=Adjustment. "
        "Never overwrite Calculated."
    )
    rec["A2"].font = muted_font
    rec.merge_cells("A2:G2")
    for i, h in enumerate(
        [
            "Account",
            "Type",
            "Calculated",
            "Actual",
            "Difference",
            "Last Reconciled",
            "Notes",
            "Include in Net Worth",
            "Include in Liquid Cash",
            "Account Group",
        ],
        1,
    ):
        rec.cell(4, i, h)
    style_header_row(rec, 4, 1, 10)

    n_acc_slots = len(ACCOUNTS) + CFG_ACC_EXTRA_ROWS
    for i in range(n_acc_slots):
        rec_r = REC_ACC_START + i
        cfg_r = CFG_ACC_START + i
        _write_reconciliation_account_row(rec, rec_r, cfg_r, overwrite_actual=True)

    how_r = REC_ACC_START + n_acc_slots + 2
    rec.cell(how_r, 1, "HOW TO FIX A DIFFERENCE")
    rec.cell(how_r, 1).font = section_font
    for i, line in enumerate(
        [
            "1. Investigate bank statement / UPI history for the gap.",
            "2. If you find the missing txn → add it to the Ledger (do not edit Calculated).",
            "3. If you cannot find it → Ledger: Type=Adjustment, Category=Reconciliation, Notes=explain.",
            "4. After Ledger update, Calculated should match Actual. Set Last Reconciled = today.",
            '5. Never type over a balance to "make it right" — that destroys history.',
        ]
    ):
        rec.cell(how_r + 1 + i, 1, line)

    for col, w in zip(
        list("ABCDEFGHIJ"), [20, 12, 14, 14, 12, 16, 40, 20, 22, 16]
    ):
        rec.column_dimensions[col].width = w

    # ── Planned Expenses (planning only — never Ledger) ──────────────
    pe = wb.create_sheet("Planned Expenses")
    populate_planned_expenses(pe, seed=True)

    # ── Dashboards ─────────────────────────────────────────────────────
    simple = wb.create_sheet("Simple Dashboard")
    populate_simple_dashboard(simple)
    detailed = wb.create_sheet("Detailed Dashboard")
    populate_detailed_dashboard(detailed, n_accounts=len(ACCOUNTS))

    wb._sheets = [simple, detailed, led, mb, rec, pe, cfg]
    wb.save(OUT)
    print(f"Wrote {OUT}")
    print("Sheets:", wb.sheetnames)
    return OUT


def patch_live_categories(wb) -> tuple[int, int]:
    """Rewrite Configuration categories (with Group) + blank rows; move RULES below.
    Returns (cat_start, cat_dv_end) for Ledger validation.
    """
    cfg = wb["Configuration"]
    # Drop merges in the categories/rules zone first (MergedCell is read-only)
    for mr in list(cfg.merged_cells.ranges):
        if mr.min_row >= 24:
            cfg.unmerge_cells(str(mr))
    # Clear old categories + rules block
    for r in range(24, 100):
        for c in range(1, 7):
            cell = cfg.cell(r, c)
            cell.value = None
            cell.fill = PatternFill()
            cell.font = Font()
            cell.border = Border()

    cfg["A24"] = "CATEGORIES"
    cfg["A24"].font = section_font
    cfg["A24"].fill = section_fill
    cfg.merge_cells("A24:C24")
    cfg["A25"] = (
        "Add new rows under the list (yellow). Group helps review. "
        "Typical Budget? = default hint — override per Ledger entry."
    )
    cfg["A25"].font = muted_font
    cfg.merge_cells("A25:C25")
    cfg["A26"] = "Category"
    cfg["B26"] = "Group"
    cfg["C26"] = "Typical Budget?"
    style_header_row(cfg, 26, 1, 3)
    CAT_START = 27
    for i, (cat, group, bud) in enumerate(CATEGORIES):
        r = CAT_START + i
        cfg.cell(r, 1, cat).fill = yellow_fill
        cfg.cell(r, 1).border = thin
        cfg.cell(r, 2, group).fill = yellow_fill
        cfg.cell(r, 2).border = thin
        cfg.cell(r, 3, "TRUE" if bud else "FALSE").fill = yellow_fill
        cfg.cell(r, 3).border = thin
    CAT_END = CAT_START + len(CATEGORIES) - 1
    EXTRA_CAT_ROWS = 15
    for r in range(CAT_END + 1, CAT_END + 1 + EXTRA_CAT_ROWS):
        for c in (1, 2, 3):
            cfg.cell(r, c).fill = yellow_fill
            cfg.cell(r, c).border = thin
    CAT_DV_END = CAT_END + EXTRA_CAT_ROWS

    rules_header = CAT_DV_END + 2
    cfg.cell(rules_header, 1, "RULES").font = section_font
    cfg.cell(rules_header, 1).fill = section_fill
    rules = [
        "1. Enter every money movement exactly once in the Ledger. Never edit calculated balances.",
        "2. From Account / To Account replace Payment Method + Credit Card.",
        "3. Amount is always positive. Direction is entirely From → To.",
        "4. Include in Budget = TRUE only for normal monthly spends under the budget cap.",
        "5. Rent, EMI, salary, transfers, investments, CC bill payments → usually Budget = FALSE.",
        "6. Opening balances on this sheet are the ONLY manual balance inputs (starting point).",
        "7. When calculated ≠ bank app, use Reconciliation → add missing Ledger row or Adjustment.",
        "8. Asset = Opening + To − From. Liability due = Opening + From − To.",
        "9. Prefer a specific category over Other — Dashboard review becomes much easier.",
        "10. To add a category: fill the next blank yellow row (name + Group + Typical Budget?).",
    ]
    for i, rule in enumerate(rules):
        rr = rules_header + 1 + i
        cfg.cell(rr, 1, rule)
        cfg.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=6)

    cfg.column_dimensions["A"].width = 28
    cfg.column_dimensions["B"].width = 16
    cfg.column_dimensions["C"].width = 16
    return CAT_START, CAT_DV_END


def patch_live_ledger_category_validation(wb, cat_start: int, cat_dv_end: int) -> None:
    led = wb["Ledger"]
    # Replace category list validation
    keep = []
    for dv in list(led.data_validations.dataValidation):
        sq = str(dv.sqref)
        # Drop old category validators on column J
        if "J" in sq and dv.type == "list" and dv.formula1 and "Configuration!$A$" in str(dv.formula1):
            continue
        keep.append(dv)
    led.data_validations.dataValidation = keep
    dv_cat = DataValidation(
        type="list",
        formula1=f"Configuration!$A${cat_start}:$A${cat_dv_end}",
        allow_blank=True,
    )
    led.add_data_validation(dv_cat)
    dv_cat.add(f"J2:J{LEDGER_PREFILL_LAST_ROW}")


def _n_accounts_from_wb(wb) -> int:
    n_accounts = len(ACCOUNTS)
    if "Configuration" in wb.sheetnames:
        cfg = wb["Configuration"]
        count = 0
        for r in range(11, 40):
            if cfg.cell(r, 1).value:
                count += 1
            else:
                break
        if count:
            n_accounts = count
    return n_accounts


def _recreate_sheet(wb, name: str, preferred_index: int = 0):
    """Delete sheet if present and recreate at preferred_index (or append)."""
    if name in wb.sheetnames:
        del wb[name]
    # Clamp index to current sheet count
    idx = min(preferred_index, len(wb.sheetnames))
    return wb.create_sheet(name, idx)


def patch_live_monthly_salary(wb) -> None:
    """Ensure Configuration has Monthly Salary at B7 (does not shift account rows)."""
    cfg = wb["Configuration"]
    # Row 7 sits between Budget default (6) and ACCOUNTS header (8) — safe insert point
    label = str(cfg["A7"].value or "").strip().lower()
    if "salary" not in label:
        cfg["A7"] = "Monthly Salary (₹)"
        cfg["A7"].border = thin
        # Preserve any existing number the user may have typed into B7 already
        existing = cfg["B7"].value
        if existing is None or (isinstance(existing, str) and not str(existing).strip()):
            money_cell(cfg["B7"], value=0, editable=True)
        else:
            money_cell(cfg["B7"], value=existing, editable=True)
        cfg["C7"] = "Take-home used for next-month free-to-allocate estimate on dashboards"
        cfg["C7"].font = muted_font
    elif cfg["B7"].value is None:
        money_cell(cfg["B7"], value=0, editable=True)


def patch_live_dashboard(path: Path | None = None) -> Path:
    """Rebuild Simple + Detailed dashboards; refresh categories + salary config."""
    path = path or LIVE
    if not path.exists():
        raise SystemExit(f"Live workbook not found: {path}")
    wb = load_workbook(path)

    patch_live_monthly_salary(wb)
    cat_start, cat_dv_end = patch_live_categories(wb)
    patch_live_ledger_category_validation(wb, cat_start, cat_dv_end)

    # Drop legacy single "Dashboard" if still present
    if "Dashboard" in wb.sheetnames:
        del wb["Dashboard"]

    # Ensure Planned Expenses exists; do not wipe existing planning data on rebuild
    if "Planned Expenses" not in wb.sheetnames:
        pe = wb.create_sheet("Planned Expenses")
        populate_planned_expenses(pe, seed=True)
        print("Created Planned Expenses sheet (seeded sample rows)")

    n_accounts = _n_accounts_from_wb(wb)
    simple = _recreate_sheet(wb, "Simple Dashboard", 0)
    populate_simple_dashboard(simple)
    detailed = _recreate_sheet(wb, "Detailed Dashboard", 1)
    populate_detailed_dashboard(detailed, n_accounts=n_accounts)

    # Preferred order: Simple first, then Detailed, then the rest
    preferred = ["Simple Dashboard", "Detailed Dashboard"]
    rest = [s for s in wb.sheetnames if s not in preferred]
    order = preferred + rest
    wb._sheets = [wb[s] for s in order if s in wb.sheetnames]
    wb.save(path)
    print(f"Patched Simple + Detailed dashboards + categories on {path}")
    print(f"Categories: {len(CATEGORIES)} (+15 blank slots), validation A{cat_start}:A{cat_dv_end}")
    print(f"Charts on Detailed Dashboard: {len(detailed._charts)}")
    print("Simple free-to-allocate formula:", simple["B21"].value)
    print("Simple committed-cash formula:", simple["B20"].value)
    print("Simple next-month free formula:", simple["B29"].value)
    print("Config monthly salary (B7):", wb["Configuration"]["B7"].value)
    return path


def ensure_planned_expenses_live(path: Path | None = None, *, seed: bool = True) -> Path:
    """
    Surgical live update:
      - create/refresh Planned Expenses sheet (seed only if new or empty)
      - append Planned Expenses summary block on Simple + Detailed dashboards
        without recreating those sheets.
    Does not touch Ledger, Monthly Budget, Reconciliation, or Configuration.
    """
    path = path or LIVE
    if not path.exists():
        raise SystemExit(f"Live workbook not found: {path}")
    wb = load_workbook(path)

    created = False
    if "Planned Expenses" in wb.sheetnames:
        pe = wb["Planned Expenses"]
        # Refresh layout only if sheet looks empty (no title)
        if not pe["A1"].value:
            populate_planned_expenses(pe, seed=seed)
            created = True
        # else keep user data as-is
    else:
        pe = wb.create_sheet("Planned Expenses")
        populate_planned_expenses(pe, seed=seed)
        created = True

    # Simple Dashboard — find free row after existing content
    if "Simple Dashboard" in wb.sheetnames:
        simple = wb["Simple Dashboard"]
        # Avoid duplicating if already linked
        already = False
        for r in range(1, min(simple.max_row or 1, 80) + 1):
            v = simple.cell(r, 1).value
            if v and "PLANNED EXPENSES" in str(v).upper():
                already = True
                break
        if not already:
            last = 1
            for r in range(1, 80):
                if any(simple.cell(r, c).value is not None for c in range(1, 5)):
                    last = r
            start = last + 2
            _add_planned_summary_block(simple, start, cols="D")
            print(f"Simple Dashboard: Planned Expenses block at row {start}")
        else:
            print("Simple Dashboard: Planned Expenses block already present")

    # Detailed Dashboard — place below existing content / charts note
    if "Detailed Dashboard" in wb.sheetnames:
        detailed = wb["Detailed Dashboard"]
        already = False
        for r in range(1, min(detailed.max_row or 1, 100) + 1):
            v = detailed.cell(r, 1).value
            if v and "PLANNED EXPENSES" in str(v).upper():
                already = True
                break
        if not already:
            last = 1
            for r in range(1, 100):
                if any(detailed.cell(r, c).value is not None for c in range(1, 7)):
                    last = r
            start = max(last + 2, 45)
            _add_planned_summary_block(detailed, start, cols="F")
            print(f"Detailed Dashboard: Planned Expenses block at row {start}")
        else:
            print("Detailed Dashboard: Planned Expenses block already present")

    # Prefer Planned Expenses after Reconciliation in tab order if newly created
    preferred = [
        "Simple Dashboard",
        "Detailed Dashboard",
        "Ledger",
        "Monthly Budget",
        "Reconciliation",
        "Planned Expenses",
        "Configuration",
    ]
    rest = [s for s in wb.sheetnames if s not in preferred]
    order = [s for s in preferred if s in wb.sheetnames] + rest
    wb._sheets = [wb[s] for s in order]

    wb.save(path)
    print(f"Planned Expenses ensured on {path} (created/refreshed={created})")
    print("Sheets:", wb.sheetnames)
    return path


def _atomic_save_live(wb, path: Path) -> None:
    import os

    tmp = path.with_suffix(".xlsx.writing")
    try:
        wb.save(tmp)
        os.replace(tmp, path)
    except Exception:
        try:
            if tmp.is_file():
                tmp.unlink()
        except OSError:
            pass
        raise


def _last_used_row(ws, max_scan: int = 120, max_col: int = 6) -> int:
    last = 1
    for r in range(1, max_scan + 1):
        if any(ws.cell(r, c).value is not None for c in range(1, max_col + 1)):
            last = r
    return last


def ensure_commitment_forecast_live(path: Path | None = None) -> Path:
    """
    Surgical live update (does NOT recreate dashboards):
      - Kind column on Planned Expenses + classify existing rows
      - Helper columns Q:X (Active? / Effective Kind / cash due per month)
      - NEXT 6 MONTHS cash-due table (L4:P13) as SUMIFS on those helpers
      - Monthly Fixed Cost (B5) = this month cash due (P6)
      - Append 6-month table on Simple + Detailed if missing
      - Refresh MacBook SmartEMI notes from the HDFC letter
    Does not touch Ledger, Monthly Budget, Reconciliation, or Configuration.
    """
    path = path or LIVE
    if not path.exists():
        raise SystemExit(f"Live workbook not found: {path}")
    wb = load_workbook(path)
    if "Planned Expenses" not in wb.sheetnames:
        raise SystemExit("No Planned Expenses sheet — run --planned-expenses first")

    pe = wb["Planned Expenses"]
    kind_col = _ensure_kind_column(pe)
    _write_planned_forecast_table(pe, kind_col)

    # This month cash due (date-aware), not yearly÷12 of every Active row
    pe["B5"] = "=P6"
    pe["B5"].font = big_num_font
    pe["B5"].fill = soft_fill
    pe["B5"].number_format = inr
    pe["A11"] = (
        "Monthly Fixed Cost = this month's recurring cash due (P6). "
        "Kind splits Loan / EMI vs Lifestyle vs Investment. "
        "Start/End dates include a month if they overlap it. "
        "Yearly amounts count in the due month only. "
        "Q:X helpers feed M6:O11 via SUMIFS."
    )

    # MacBook SmartEMI — keep amount ₹38,200; document letter details in Notes
    notes_col = None
    for c in range(1, 16):
        v = pe.cell(14, c).value
        if v and str(v).strip().lower() == "notes":
            notes_col = c
            break
    for r in range(15, 65):
        name = str(pe.cell(r, 1).value or "")
        if "smartemi" not in name.lower() and "macbook" not in name.lower():
            continue
        pe.cell(r, kind_col, PE_KIND_LOAN)
        if notes_col:
            pe.cell(r, notes_col).value = (
                "HDFC SmartEMI 144274447 · principal ₹2,19,500 · 6 mo @ 1.25% p.m. "
                "· billed EMI ₹38,200 (first due 12-Sep-2026 is ₹40,121; last ₹38,203) "
                "· GST 18% on interest extra · HDFC CC"
            )
        break

    def _refresh_fixed_cost_caption(dash) -> None:
        for r in range(1, min(dash.max_row or 1, 80) + 1):
            if str(dash.cell(r, 1).value or "").strip().lower() != "monthly fixed cost":
                continue
            note = str(dash.cell(r, 3).value or "")
            if "monthly equivalent" in note.lower() or not note:
                dash.cell(r, 3).value = "this month cash due (Start/End + Kind)"
                dash.cell(r, 3).font = muted_font

    if "Simple Dashboard" in wb.sheetnames:
        simple = wb["Simple Dashboard"]
        _refresh_fixed_cost_caption(simple)
        if not _dashboard_has_block(simple, "NEXT 6 MONTHS"):
            start = _last_used_row(simple, 80, 5) + 2
            _add_commitment_forecast_block(simple, start, cols="E")
            print(f"Simple Dashboard: NEXT 6 MONTHS block at row {start}")
        else:
            print("Simple Dashboard: NEXT 6 MONTHS block already present — not rewritten")

    if "Detailed Dashboard" in wb.sheetnames:
        detailed = wb["Detailed Dashboard"]
        _refresh_fixed_cost_caption(detailed)
        if not _dashboard_has_block(detailed, "NEXT 6 MONTHS"):
            # Stay below the category chart (~rows 55–73)
            start = max(_last_used_row(detailed, 100, 6) + 2, 75)
            _add_commitment_forecast_block(detailed, start, cols="E")
            print(f"Detailed Dashboard: NEXT 6 MONTHS block at row {start}")
        else:
            print("Detailed Dashboard: NEXT 6 MONTHS block already present — not rewritten")

    _atomic_save_live(wb, path)
    print(f"Commitment forecast ensured on {path}")
    print(f"Kind column: {get_column_letter(kind_col)}")
    return path


def patch_live_monthly_budget_grid(
    path: Path | None = None, through: ddate | None = None
) -> Path:
    """
    Surgical live update (does NOT recreate dashboards):
      - rewrite month-by-month derived formulas (C–L) on every existing month row
      - extend the grid with the same formulas through `through` (default Dec 2032)
      - convert the grid to Excel table MonthlyBudget
      - widen THIS MONTH / next-month INDEX-MATCH to $A$20:$A$200
    Does not change Ledger, Reconciliation, Configuration, or dashboard layout.
    Does not overwrite existing Budget (col B) values.
    """
    path = path or LIVE
    through = through or MB_GRID_END
    if not path.exists():
        raise SystemExit(f"Live workbook not found: {path}")
    wb = load_workbook(path)
    if "Monthly Budget" not in wb.sheetnames:
        raise SystemExit("Workbook has no Monthly Budget sheet")

    mb = wb["Monthly Budget"]
    last = _mb_last_date_row(mb)
    if last is None:
        raise SystemExit("Monthly Budget has no month-start dates from row 20")

    first = _month_start_value(mb.cell(MB_FIRST_DATA_ROW, 1).value)
    if first is None:
        raise SystemExit("Monthly Budget A20 is not a month-start date")

    rewritten = 0
    for r in range(MB_FIRST_DATA_ROW, last + 1):
        _apply_monthly_budget_derived_row(mb, r)
        rewritten += 1

    default_budget = 31000
    if "Configuration" in wb.sheetnames:
        cfg_b6 = wb["Configuration"]["B6"].value
        if isinstance(cfg_b6, (int, float)):
            default_budget = cfg_b6
    last_budget = mb.cell(last, 2).value
    if isinstance(last_budget, (int, float)):
        default_budget = last_budget

    last_month = _month_start_value(mb.cell(last, 1).value)
    added = 0
    r = last
    while last_month is not None and last_month < through:
        r += 1
        last_month = _add_calendar_months(last_month, 1)
        _write_monthly_budget_month_row(mb, r, last_month, default_budget)
        added += 1
    last = r

    mb["A18"] = (
        "MONTH-BY-MONTH — only Budget (col B) is editable. "
        "Derived columns are formulas. Table MonthlyBudget: add a row at the bottom to extend."
    )
    mb["B6"] = _FORM_THIS_MONTH_BUDGET
    _ensure_monthly_budget_table(mb, last)
    lookup_cells = _widen_monthly_budget_lookups(wb)
    _atomic_save_live(wb, path)
    print(f"Patched Monthly Budget grid on {path}")
    print(f"  first month: {first.isoformat()} (row {MB_FIRST_DATA_ROW})")
    print(f"  last month:  {last_month.isoformat()} (row {last})")
    print(f"  rewritten derived rows: {rewritten}")
    print(f"  added month rows: {added}")
    print(f"  table: {MB_TABLE_NAME} A{MB_HEADER_ROW}:L{last}")
    print(f"  widened lookups: {', '.join(lookup_cells) if lookup_cells else '(none)'}")
    return path


def patch_live_ledger_prefill(path: Path | None = None) -> Path:
    """
    Surgical live update (does NOT recreate dashboards):
      Prefill Ledger Day/Month/Year and Include in Budget on empty rows
      through LEDGER_PREFILL_LAST_ROW so a typed-in transaction is not
      silently dropped from SUMIFS(..., K:K, TRUE()).
    Does not change existing dated Ledger rows.
    """
    path = path or LIVE
    if not path.exists():
        raise SystemExit(f"Live workbook not found: {path}")
    wb = load_workbook(path)
    if "Ledger" not in wb.sheetnames:
        raise SystemExit("No Ledger sheet")

    led = wb["Ledger"]
    last_data = 1
    for r in range(2, (led.max_row or 1) + 1):
        if led.cell(r, 1).value is not None or led.cell(r, 6).value is not None:
            last_data = r

    target = max(LEDGER_PREFILL_LAST_ROW, last_data + LEDGER_PREFILL_BUFFER)
    filled = 0
    for r in range(last_data + 1, target + 1):
        if led.cell(r, 1).value is not None or led.cell(r, 6).value is not None:
            continue
        _prefill_ledger_empty_row(led, r)
        filled += 1

    led.auto_filter.ref = f"A1:M{target}"
    dv_changed = _extend_ledger_validation_refs(led, target)
    _atomic_save_live(wb, path)
    print(f"Patched Ledger prefill on {path}")
    print(f"  last data row: {last_data}")
    print(f"  prefill through: {target} ({filled} empty rows)")
    print(f"  autofilter: {led.auto_filter.ref}")
    print(f"  widened validations: {', '.join(dv_changed) if dv_changed else '(none)'}")
    return path


def patch_live_free_to_allocate(path: Path | None = None) -> Path:
    """
    Surgical live update (does NOT recreate dashboards):
      Redefine Free to allocate as liquid − budget reserved − committed cash.
      Committed = CC due + remaining EMI this month + Planned one-time (30d).
      Next-month estimate subtracts next month's EMI instead of CC (CC is
      already in today's free).
    Does not change Ledger, Monthly Budget, Reconciliation, Configuration,
    or Planned Expenses data/formulas.
    """
    path = path or LIVE
    if not path.exists():
        raise SystemExit(f"Live workbook not found: {path}")
    wb = load_workbook(path)

    if "Simple Dashboard" in wb.sheetnames:
        simple = wb["Simple Dashboard"]
        liq_r = _find_row_by_label(simple, "Total liquid savings")
        bud_r = _find_row_by_label(simple, "Budget still reserved")
        committed_r = _find_row_by_label(simple, "Committed cash")
        free_r = _find_row_by_label(simple, "Free to allocate")
        cc_total_r = _find_row_by_label(simple, "Total CC due")
        free_today_r = _find_row_by_label(simple, "Free to allocate (today)")
        est_r = _find_row_by_label(simple, "Est. free next month")
        cc_pay_r = _find_row_containing(simple, "pay all cc")
        hdr_r = _find_row_containing(simple, "free to allocate")

        if liq_r is None or bud_r is None or free_r is None or cc_total_r is None:
            raise SystemExit("Simple Dashboard is missing liquid/budget/free/CC rows")

        if committed_r is None:
            # Live sheet has a blank row under Free to allocate — reuse it.
            committed_r = free_r
            new_free_r = free_r + 1
            below = simple.cell(new_free_r, 1).value
            if below is not None and str(below).strip():
                raise SystemExit(
                    f"Simple Dashboard row {new_free_r} is not empty; "
                    "cannot insert Committed cash without shifting the sheet"
                )
            free_r = new_free_r

        cc_cell = f"B{cc_total_r}"
        _label(simple.cell(committed_r, 1), "Committed cash", bold=True)
        money_cell(
            simple.cell(committed_r, 2),
            formula=_form_committed_cash(cc_cell),
            fill=alert_fill,
        )
        simple.cell(committed_r, 2).font = Font(bold=True, size=12)
        simple.cell(committed_r, 3).value = (
            "CC due + remaining EMI this month + one-time (30d)"
        )
        simple.cell(committed_r, 3).font = muted_font

        _label(simple.cell(free_r, 1), "Free to allocate", bold=True)
        money_cell(
            simple.cell(free_r, 2),
            formula=_form_free_less_committed(f"B{liq_r}", f"B{bud_r}", f"B{committed_r}"),
            fill=good_fill,
        )
        simple.cell(free_r, 2).font = Font(
            name="Calibri", size=16, bold=True, color="1F4E79"
        )
        simple.cell(free_r, 3).value = "liquid − budget reserved − committed"
        simple.cell(free_r, 3).font = muted_font

        if bud_r:
            simple.cell(bud_r, 3).value = "discretionary envelope still unused this month"
            simple.cell(bud_r, 3).font = muted_font

        if hdr_r and "emergency" in str(simple.cell(hdr_r, 1).value or "").lower():
            simple.cell(hdr_r, 1).value = (
                "FREE TO ALLOCATE — after budget, bills, near-term plans"
            )
            simple.cell(hdr_r, 1).font = section_font
            simple.cell(hdr_r, 1).fill = section_fill

        if free_today_r:
            money_cell(simple.cell(free_today_r, 2), formula=f"=B{free_r}")
            simple.cell(free_today_r, 3).value = (
                "starting point (already nets CC + this month's remaining EMI + 30d)"
            )
            simple.cell(free_today_r, 3).font = muted_font

        next_emi_r = _find_row_containing(simple, "next month loan")
        if next_emi_r is None:
            next_emi_r = cc_pay_r
        if next_emi_r is None:
            raise SystemExit("Simple Dashboard is missing the next-month CC/EMI row")
        _label(simple.cell(next_emi_r, 1), "− Next month Loan / EMI")
        money_cell(simple.cell(next_emi_r, 2), formula=_FORM_NEXT_MONTH_EMI)
        simple.cell(next_emi_r, 3).value = "outside the monthly budget cap"
        simple.cell(next_emi_r, 3).font = muted_font

        if est_r:
            simple.cell(est_r, 3).value = "after next EMI + salary + next budget"
            simple.cell(est_r, 3).font = muted_font

        note_r = _find_row_containing(simple, "estimate = free-to-allocate")
        if note_r is None:
            note_r = _find_row_containing(simple, "assumes you finish this month")
        if note_r is not None:
            simple.cell(note_r, 1).value = (
                "Estimate = free today − next month's EMI + monthly salary − next month's budget. "
                "Today's free already reserves CC due, this month's remaining EMI, and 30-day one-time plans. "
                "If this month's salary is already in liquid savings, it is already counted — "
                "use Configuration monthly salary as take-home you expect to receive for the next cycle."
            )
            simple.cell(note_r, 1).font = muted_font

        print(
            f"Simple Dashboard: committed B{committed_r}={simple.cell(committed_r, 2).value}"
        )
        print(f"Simple Dashboard: free B{free_r}={simple.cell(free_r, 2).value}")
        print(f"Simple Dashboard: next EMI B{next_emi_r}={simple.cell(next_emi_r, 2).value}")

    if "Detailed Dashboard" in wb.sheetnames:
        detailed = wb["Detailed Dashboard"]
        liq_r = _find_row_by_label(detailed, "Total liquid savings")
        bud_r = _find_row_by_label(detailed, "Budget still reserved")
        free_r = _find_row_by_label(detailed, "Free to allocate")
        cc_total_r = _find_row_by_label(detailed, "Total CC due", col=4)
        if cc_total_r is None:
            cc_total_r = _find_row_by_label(detailed, "Total CC due")
        cc_pay_r = _find_row_containing(detailed, "pay all cc", col=4)
        if cc_pay_r is None:
            cc_pay_r = _find_row_containing(detailed, "pay all cc")
        next_emi_r = _find_row_containing(detailed, "next month loan", col=4)
        if next_emi_r is None:
            next_emi_r = _find_row_containing(detailed, "next month loan")
        hdr_r = _find_row_containing(detailed, "free to allocate")

        if liq_r is None or bud_r is None or free_r is None or cc_total_r is None:
            raise SystemExit("Detailed Dashboard is missing liquid/budget/free/CC rows")

        cc_col = 5  # E
        money_cell(
            detailed.cell(free_r, 2),
            formula=_form_free_detailed(
                liquid=f"B{liq_r}",
                budget=f"B{bud_r}",
                cc=f"{get_column_letter(cc_col)}{cc_total_r}",
            ),
            fill=good_fill,
        )
        detailed.cell(free_r, 2).font = Font(
            name="Calibri", size=14, bold=True, color="1F4E79"
        )

        if hdr_r and "emergency" in str(detailed.cell(hdr_r, 1).value or "").lower():
            detailed.cell(hdr_r, 1).value = (
                "FREE TO ALLOCATE — after budget, bills, near-term plans"
            )
            detailed.cell(hdr_r, 1).font = section_font
            detailed.cell(hdr_r, 1).fill = section_fill

        if next_emi_r is None:
            next_emi_r = cc_pay_r
        if next_emi_r is not None:
            _label(detailed.cell(next_emi_r, 4), "− Next month Loan / EMI")
            money_cell(detailed.cell(next_emi_r, 5), formula=_FORM_NEXT_MONTH_EMI)

        note_r = _find_row_containing(detailed, "does not subtract cc")
        if note_r is None:
            note_r = _find_row_containing(detailed, "free to allocate = liquid")
        if note_r is not None:
            detailed.cell(note_r, 1).value = (
                "Free to allocate = liquid − budget remaining − CC due − remaining EMI "
                "this month − Planned one-time (30d). Rent/family inside the budget cap "
                "are not subtracted twice. Next-month estimate = free today − next EMI "
                "+ salary − next budget. Set Monthly Salary on Configuration."
            )
            detailed.cell(note_r, 1).font = muted_font

        print(f"Detailed Dashboard: free B{free_r}={detailed.cell(free_r, 2).value}")
        if next_emi_r:
            print(
                f"Detailed Dashboard: next EMI E{next_emi_r}="
                f"{detailed.cell(next_emi_r, 5).value}"
            )

    _atomic_save_live(wb, path)
    print(f"Patched free-to-allocate definition on {path}")
    return path


def _copy_cells(ws, src_rows: range, src_cols: range, dest_row: int, dest_col: int) -> None:
    for r in src_rows:
        for c in src_cols:
            src = ws.cell(r, c)
            dest = ws.cell(dest_row + (r - src_rows.start), dest_col + (c - src_cols.start))
            dest.value = src.value
            dest.font = copy(src.font)
            dest.fill = copy(src.fill)
            dest.border = copy(src.border)
            dest.alignment = copy(src.alignment)
            dest.number_format = src.number_format


def _clear_cells(ws, rows: range, cols: range) -> None:
    for r in rows:
        for c in cols:
            cell = ws.cell(r, c)
            cell.value = None
            cell.fill = PatternFill()
            cell.font = Font()
            cell.border = Border()


def _replace_merge(ws, old: str, new: str) -> None:
    try:
        ws.unmerge_cells(old)
    except Exception:
        pass
    already = any(str(m) == new for m in ws.merged_cells.ranges)
    if not already:
        ws.merge_cells(new)


def _header_is(cfg, col: int, *needles: str) -> bool:
    v = str(cfg.cell(CFG_ACC_HEADER_ROW, col).value or "").strip().lower()
    return any(n in v for n in needles)


def _ensure_config_classification_columns(cfg) -> bool:
    """Add Include in Liquid Cash + Account Group; move Notes to H; types to J.

    Returns True if columns were migrated this run.
    """
    if _header_is(cfg, 6, "liquid") and _header_is(cfg, 7, "account group"):
        return False

    types_in_h = "ledger type" in str(cfg.cell(8, 8).value or "").strip().lower()
    if types_in_h:
        # Guide first (I:J → K:L), then types (H → J), then free H for Notes.
        _copy_cells(cfg, range(8, 17), range(9, 11), 8, 11)
        _copy_cells(cfg, range(8, 17), range(8, 9), 8, 10)
        _clear_cells(cfg, range(8, 17), range(8, 10))

    if _header_is(cfg, 6, "note"):
        for r in range(CFG_ACC_START, CFG_ACC_START + 40):
            name_s = str(cfg.cell(r, 1).value or "").strip()
            if name_s.upper() in {"CATEGORIES", "CATEGORY", "RULES"}:
                break
            notes = cfg.cell(r, 6).value
            if notes not in (None, "") and cfg.cell(r, 8).value in (None, ""):
                cfg.cell(r, 8).value = notes
                cfg.cell(r, 8).fill = yellow_fill
                cfg.cell(r, 8).border = thin
            # F was Notes; free it for Include in Liquid Cash.
            cfg.cell(r, 6).value = None
            cfg.cell(r, 6).fill = yellow_fill
            cfg.cell(r, 6).border = thin
            cfg.cell(r, 7).fill = yellow_fill
            cfg.cell(r, 7).border = thin

    cfg.cell(CFG_ACC_HEADER_ROW, 6, "Include in Liquid Cash")
    cfg.cell(CFG_ACC_HEADER_ROW, 7, "Account Group")
    cfg.cell(CFG_ACC_HEADER_ROW, 8, "Notes")
    style_header_row(cfg, CFG_ACC_HEADER_ROW, 1, 8)

    _replace_merge(cfg, "A2:G2", "A2:H2")
    _replace_merge(cfg, "A8:F8", "A8:H8")
    _replace_merge(cfg, "A9:F9", "A9:H9")
    cfg["A9"] = (
        "Every ledger entry moves money From Account → To Account. "
        "Opening Balance is the starting point only. "
        "Dashboards SUMIFS Include in Liquid Cash / Include in Net Worth / Account Group."
    )
    cfg["A9"].font = muted_font

    cfg["J8"] = "LEDGER TYPES"
    cfg["J8"].font = section_font
    cfg["J8"].fill = section_fill
    if cfg["J9"].value is None:
        cfg["J9"] = "Type"
        cfg["J9"].font = header_font
        cfg["J9"].fill = header_fill

    for col, w in zip(
        list("ABCDEFGHJKL"), [28, 14, 18, 18, 20, 22, 16, 36, 22, 22, 70]
    ):
        cfg.column_dimensions[col].width = w
    return True


def _fill_named_account_flags(cfg) -> int:
    filled = 0
    for r in range(CFG_ACC_START, CFG_ACC_LOOKUP_LAST + 1):
        name = cfg.cell(r, 1).value
        if name is None:
            continue
        name_s = str(name).strip()
        if name_s.upper() in {"CATEGORIES", "CATEGORY", "RULES"}:
            break
        typ = str(cfg.cell(r, 2).value or "").strip()
        liquid, group = _default_liquid_and_group(name_s, typ)
        _style_config_account_row(cfg, r)
        if cfg.cell(r, 6).value in (None, ""):
            cfg.cell(r, 6, _cfg_bool_text(liquid))
            filled += 1
        if cfg.cell(r, 7).value in (None, ""):
            cfg.cell(r, 7, group)
        if cfg.cell(r, 5).value in (None, ""):
            nw_default = typ != "Virtual"
            cfg.cell(r, 5, _cfg_bool_text(nw_default))
    return filled


def _ensure_config_account_slots(cfg, extra: int = CFG_ACC_EXTRA_ROWS) -> int:
    """Insert blank yellow account rows before CATEGORIES. Returns last slot row."""
    cat_r = None
    for r in range(CFG_ACC_START, 80):
        if str(cfg.cell(r, 1).value or "").strip().upper() == "CATEGORIES":
            cat_r = r
            break
    if cat_r is None:
        return CFG_ACC_START + len(ACCOUNTS) + extra - 1

    last_named = CFG_ACC_START - 1
    for r in range(CFG_ACC_START, cat_r):
        if cfg.cell(r, 1).value:
            last_named = r

    blanks_before_cat = cat_r - last_named - 1
    need = extra - blanks_before_cat
    if need > 0:
        cfg.insert_rows(last_named + 1, need)
        cat_r += need
    last_slot = cat_r - 1
    for r in range(last_named + 1, last_slot + 1):
        _style_config_account_row(cfg, r)
    return last_slot


def _ensure_config_account_validations(cfg, last_slot: int) -> None:
    keep = []
    for dv in list(cfg.data_validations.dataValidation):
        sq = str(dv.sqref or "")
        if any(col in sq for col in ("B11", "E11", "F11", "G11", "B$11", "G$11")):
            continue
        # Drop previous account-flag validators we own
        formula = str(dv.formula1 or "")
        if "Asset,Liability,Virtual" in formula or ",".join(ACCOUNT_GROUPS) in formula:
            continue
        keep.append(dv)
    cfg.data_validations.dataValidation = keep
    dv_acc_type = DataValidation(
        type="list", formula1='"Asset,Liability,Virtual"', allow_blank=True
    )
    dv_acc_bool = DataValidation(type="list", formula1='"TRUE,FALSE"', allow_blank=True)
    dv_acc_group = DataValidation(
        type="list",
        formula1='"' + ",".join(ACCOUNT_GROUPS) + '"',
        allow_blank=True,
    )
    for dv in (dv_acc_type, dv_acc_bool, dv_acc_group):
        cfg.add_data_validation(dv)
    dv_acc_type.add(f"B{CFG_ACC_START}:B{last_slot}")
    dv_acc_bool.add(f"E{CFG_ACC_START}:F{last_slot}")
    dv_acc_group.add(f"G{CFG_ACC_START}:G{last_slot}")


def _add_config_account_rule(cfg) -> None:
    needle = "to add an account:"
    for r in range(1, 130):
        v = str(cfg.cell(r, 1).value or "").strip().lower()
        if needle in v:
            return
        if v == "rules":
            # append after existing numbered rules
            last = r
            for rr in range(r + 1, r + 20):
                txt = str(cfg.cell(rr, 1).value or "").strip()
                if not txt:
                    cfg.cell(rr, 1).value = (
                        "11. To add an account: fill the next blank yellow row "
                        "(Type, opening, Net Worth, Liquid Cash, Account Group). "
                        "Dashboards SUMIFS those flags — do not insert a row in the middle of the list."
                    )
                    try:
                        cfg.merge_cells(
                            start_row=rr, start_column=1, end_row=rr, end_column=8
                        )
                    except Exception:
                        pass
                    return
                last = rr
            return


def _find_category_dv_range(cfg) -> tuple[int, int] | None:
    cat_start = None
    for r in range(1, 140):
        if str(cfg.cell(r, 1).value or "").strip() == "Category" and str(
            cfg.cell(r, 2).value or ""
        ).strip() in {"Group", "Typical Budget?"}:
            cat_start = r + 1
            break
    if cat_start is None:
        return None
    last = cat_start
    for r in range(cat_start, cat_start + 130):
        v = str(cfg.cell(r, 1).value or "").strip()
        if v.upper() == "RULES":
            break
        last = r
    return cat_start, last


def _update_ledger_account_validations(led, last_slot: int, cat_range: tuple[int, int] | None) -> None:
    for dv in led.data_validations.dataValidation:
        f1 = str(dv.formula1 or "")
        sq = str(dv.sqref or "")
        if "Configuration!$H$10" in f1 or f1.startswith("Configuration!$J$10"):
            dv.formula1 = "Configuration!$J$10:$J$16"
        elif ("H2" in sq or "I2" in sq) and "J2" not in sq and "Configuration!$A$" in f1:
            dv.formula1 = f"Configuration!$A${CFG_ACC_START}:$A${last_slot}"
        elif cat_range and "J2" in sq and "H2" not in sq and "Configuration!$A$" in f1:
            c0, c1 = cat_range
            dv.formula1 = f"Configuration!$A${c0}:$A${c1}"


def _ensure_reconciliation_slots(rec, n_slots: int) -> int:
    last_rec = REC_ACC_START + n_slots - 1
    how_r = _find_row_containing(rec, "how to fix a difference")
    if how_r is not None and how_r <= last_rec + 1:
        need = last_rec + 2 - how_r
        if need > 0:
            rec.insert_rows(how_r, need)

    headers = [
        "Account",
        "Type",
        "Calculated",
        "Actual",
        "Difference",
        "Last Reconciled",
        "Notes",
        "Include in Net Worth",
        "Include in Liquid Cash",
        "Account Group",
    ]
    for i, h in enumerate(headers, 1):
        rec.cell(4, i, h)
    style_header_row(rec, 4, 1, 10)

    for i in range(n_slots):
        rec_r = REC_ACC_START + i
        cfg_r = CFG_ACC_START + i
        existing = rec.cell(rec_r, 3).value
        if existing:
            _apply_rec_class_lookups(rec, rec_r)
        else:
            _write_reconciliation_account_row(rec, rec_r, cfg_r, overwrite_actual=False)

    for col, w in zip(
        list("ABCDEFGHIJ"), [20, 12, 14, 14, 12, 16, 40, 20, 22, 16]
    ):
        rec.column_dimensions[col].width = w
    return last_rec


def _patch_named_cc_block(ws, name: str, label_col: int, amount_col: int) -> int | None:
    r = _find_row_by_label(ws, name, col=label_col, max_row=50)
    if r is None:
        return None
    label_cell = f"{get_column_letter(label_col)}{r}"
    amt_row = r
    if ws.cell(r, amount_col).value is None:
        for rr in range(r + 1, r + 4):
            lab = str(ws.cell(rr, label_col).value or "").strip().lower()
            if lab == "outstanding":
                amt_row = rr
                break
    money_cell(ws.cell(amt_row, amount_col), formula=_form_balance_for_label(label_cell))
    for rr in range(r, r + 6):
        lab = str(ws.cell(rr, label_col).value or "").strip().lower()
        if lab.startswith("limit"):
            money_cell(ws.cell(rr, amount_col), formula=_form_limit_for_label(label_cell))
            break
    return r


def _patch_dashboard_account_formulas(wb) -> list[str]:
    changed: list[str] = []
    if "Simple Dashboard" in wb.sheetnames:
        simple = wb["Simple Dashboard"]
        for name in ("HDFC Credit Card", "ICICI Credit Card"):
            r = _patch_named_cc_block(simple, name, 1, 2)
            if r:
                changed.append(f"Simple B{r} lookup {name}")
        cc_total_r = _find_row_by_label(simple, "Total CC due")
        if cc_total_r:
            money_cell(simple.cell(cc_total_r, 2), formula=_FORM_CC_DUE, fill=alert_fill)
            simple.cell(cc_total_r, 2).font = Font(bold=True, size=12)
            simple.cell(cc_total_r, 3).value = (
                "every Configuration account with Group=Credit Card"
            )
            simple.cell(cc_total_r, 3).font = muted_font
            changed.append(f"Simple B{cc_total_r} Total CC due SUMIFS")
        liq_r = _find_row_by_label(simple, "Total liquid savings")
        if liq_r:
            money_cell(simple.cell(liq_r, 2), formula=_FORM_LIQUID)
            simple.cell(liq_r, 3).value = "Configuration Include in Liquid Cash"
            simple.cell(liq_r, 3).font = muted_font
            changed.append(f"Simple B{liq_r} liquid SUMIFS")

    if "Detailed Dashboard" in wb.sheetnames:
        detailed = wb["Detailed Dashboard"]
        for name in ("HDFC Credit Card", "ICICI Credit Card"):
            r = _patch_named_cc_block(detailed, name, 4, 5)
            if r:
                changed.append(f"Detailed E lookup {name} (label row {r})")
        cc_total_r = _find_row_by_label(detailed, "Total CC due", col=4)
        if cc_total_r is None:
            cc_total_r = _find_row_by_label(detailed, "Total CC due")
        if cc_total_r:
            money_cell(detailed.cell(cc_total_r, 5), formula=_FORM_CC_DUE, fill=alert_fill)
            detailed.cell(cc_total_r, 5).font = Font(bold=True, size=12)
            changed.append(f"Detailed E{cc_total_r} Total CC due SUMIFS")
        liq_r = _find_row_by_label(detailed, "Total liquid savings")
        if liq_r:
            money_cell(detailed.cell(liq_r, 2), formula=_FORM_LIQUID)
            changed.append(f"Detailed B{liq_r} liquid SUMIFS")
        sav_r = _find_row_by_label(detailed, "Savings & Cash", col=4)
        if sav_r:
            money_cell(detailed.cell(sav_r, 5), formula=_FORM_LIQUID)
            changed.append(f"Detailed E{sav_r} Savings & Cash SUMIFS")
        fd_r = _find_row_by_label(detailed, "FD", col=4)
        if fd_r:
            money_cell(detailed.cell(fd_r, 5), formula=_FORM_FD)
            changed.append(f"Detailed E{fd_r} FD SUMIFS")
        inv_r = _find_row_by_label(detailed, "Investments (MF)", col=4)
        if inv_r is None:
            inv_r = _find_row_by_label(detailed, "Investments", col=4)
        if inv_r:
            detailed.cell(inv_r, 4).value = "Investments"
            money_cell(detailed.cell(inv_r, 5), formula=_FORM_INVESTMENTS)
            changed.append(f"Detailed E{inv_r} Investments SUMIFS")
        ast_r = _find_row_by_label(detailed, "Total Assets", col=4)
        if ast_r:
            money_cell(detailed.cell(ast_r, 5), formula=_FORM_NW_ASSETS)
            detailed.cell(ast_r, 5).font = Font(bold=True)
            changed.append(f"Detailed E{ast_r} Total Assets SUMIFS")
        liab_r = _find_row_by_label(detailed, "Credit Card Due", col=4)
        if liab_r is None:
            liab_r = _find_row_by_label(detailed, "Liabilities", col=4)
        if liab_r:
            detailed.cell(liab_r, 4).value = "Liabilities"
            money_cell(detailed.cell(liab_r, 5), formula=_FORM_NW_LIABILITIES)
            changed.append(f"Detailed E{liab_r} Liabilities SUMIFS")
    return changed


def patch_live_account_classifications(path: Path | None = None) -> Path:
    """
    Surgical live update (does NOT recreate dashboards):
      Configuration: Include in Liquid Cash + Account Group.
      Reconciliation: lookup columns + extra account slots.
      Dashboards: liquid / CC due / net worth via SUMIFS on those flags.
    Does not change Ledger transaction rows.
    """
    path = path or LIVE
    if not path.exists():
        raise SystemExit(f"Live workbook not found: {path}")
    wb = load_workbook(path)
    if "Configuration" not in wb.sheetnames:
        raise SystemExit("No Configuration sheet")
    if "Reconciliation" not in wb.sheetnames:
        raise SystemExit("No Reconciliation sheet")

    cfg = wb["Configuration"]
    migrated = _ensure_config_classification_columns(cfg)
    filled = _fill_named_account_flags(cfg)
    last_slot = _ensure_config_account_slots(cfg)
    _ensure_config_account_validations(cfg, last_slot)
    _add_config_account_rule(cfg)

    n_slots = last_slot - CFG_ACC_START + 1
    rec = wb["Reconciliation"]
    last_rec = _ensure_reconciliation_slots(rec, n_slots)

    if "Ledger" in wb.sheetnames:
        cat_range = _find_category_dv_range(cfg)
        _update_ledger_account_validations(wb["Ledger"], last_slot, cat_range)

    dash_changed = _patch_dashboard_account_formulas(wb)
    _atomic_save_live(wb, path)
    print(f"Patched account classifications on {path}")
    print(f"  config columns migrated: {migrated}")
    print(f"  named-account flags filled: {filled}")
    print(f"  config account slots: rows {CFG_ACC_START}-{last_slot} ({n_slots})")
    print(f"  reconciliation rows: {REC_ACC_START}-{last_rec}")
    print(f"  dashboard cells: {', '.join(dash_changed) if dash_changed else '(none)'}")
    return path


def patch_live_planned_helpers(path: Path | None = None) -> Path:
    """
    Surgical live update (does NOT recreate dashboards):
      Add Planned Expenses helper columns Q:X and rewrite the 6-month
      forecast from SUMPRODUCT to SUMIFS on those helpers.
    Does not change recurring/one-time data values, Ledger, Monthly Budget,
    Reconciliation, Configuration, or dashboard layout.
    """
    path = path or LIVE
    if not path.exists():
        raise SystemExit(f"Live workbook not found: {path}")
    wb = load_workbook(path)
    if "Planned Expenses" not in wb.sheetnames:
        raise SystemExit("No Planned Expenses sheet — run --planned-expenses first")

    pe = wb["Planned Expenses"]
    kind_col = _pe_kind_column(pe)
    header = pe.cell(14, kind_col).value
    if not header or str(header).strip().lower() != "kind":
        kind_col = _ensure_kind_column(pe)
    _write_planned_forecast_table(pe, kind_col)

    pe["B5"] = "=P6"
    pe["B5"].font = big_num_font
    pe["B5"].fill = soft_fill
    pe["B5"].number_format = inr
    pe["A11"] = (
        "Monthly Fixed Cost = this month's recurring cash due (P6). "
        "Kind splits Loan / EMI vs Lifestyle vs Investment. "
        "Start/End dates include a month if they overlap it. "
        "Yearly amounts count in the due month only. "
        "Q:X helpers feed M6:O11 via SUMIFS."
    )
    pe["A11"].font = muted_font

    _atomic_save_live(wb, path)
    print(f"Patched Planned Expenses helpers + SUMIFS forecast on {path}")
    print(f"  Kind column: {get_column_letter(kind_col)}")
    print(f"  helpers: Q{PE_REC_START}:X{PE_REC_END}")
    print(f"  M6: {pe['M6'].value}")
    return path


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] in {"--patch-live", "--live", "patch"}:
        patch_live_dashboard()
    elif len(sys.argv) > 1 and sys.argv[1] in {
        "--planned-expenses",
        "--ensure-planned",
        "planned",
    }:
        ensure_planned_expenses_live()
    elif len(sys.argv) > 1 and sys.argv[1] in {
        "--commitment-forecast",
        "--forecast",
        "forecast",
    }:
        ensure_commitment_forecast_live()
    elif len(sys.argv) > 1 and sys.argv[1] in {
        "--monthly-budget-grid",
        "--mb-grid",
    }:
        patch_live_monthly_budget_grid()
    elif len(sys.argv) > 1 and sys.argv[1] in {
        "--ledger-prefill",
        "--ledger-k",
    }:
        patch_live_ledger_prefill()
    elif len(sys.argv) > 1 and sys.argv[1] in {
        "--free-to-allocate",
        "--fta",
    }:
        patch_live_free_to_allocate()
    elif len(sys.argv) > 1 and sys.argv[1] in {
        "--account-classifications",
        "--account-flags",
        "--issue-4",
    }:
        patch_live_account_classifications()
    elif len(sys.argv) > 1 and sys.argv[1] in {
        "--planned-helpers",
        "--issue-5",
    }:
        patch_live_planned_helpers()
    else:
        build()
