import { useState } from "react";
import {
  defaultIncludeLiquid,
  formatInr,
  isIsoDate,
  todayIst,
  typeForAccountGroup,
  type AccountGroup,
  type IsoDate,
  type VirtualKind,
} from "../engine/index.ts";
import type { Account } from "../engine/types.ts";
import type { AccountPatchBody, AccountPostBody } from "../api/store.ts";
import { Keypad } from "./Keypad.tsx";
import {
  ACCOUNT_GROUP_LABELS,
  ACCOUNT_GROUP_ORDER,
} from "./accounts.ts";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  amountExpression,
  amountPaise,
  applyAmountKey,
  EMPTY_AMOUNT,
  type AmountDraft,
  type AmountKey,
} from "./quickAdd.ts";

type AccountFormSheetProps = {
  mode: "add" | "edit";
  account?: Account;
  buckets: readonly { id: string; name: string }[];
  today?: IsoDate;
  saving: boolean;
  onSaveAdd: (body: AccountPostBody) => void;
  onSaveEdit: (body: AccountPatchBody) => void;
};

function chipClass(on: boolean): string {
  return `chip ${on ? "chip-on" : "chip-off"}`;
}

type AmountTarget = "opening" | "limit";

export function AccountFormSheet({
  mode,
  account,
  buckets,
  today = todayIst(),
  saving,
  onSaveAdd,
  onSaveEdit,
}: AccountFormSheetProps) {
  const [name, setName] = useState(account?.name ?? "");
  const [group, setGroup] = useState<AccountGroup>(account?.group ?? "savings");
  const [opening, setOpening] = useState<AmountDraft>(EMPTY_AMOUNT);
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? today);
  const [limit, setLimit] = useState<AmountDraft>(
    account?.creditLimit != null ? amountDraftFromPaise(account.creditLimit) : EMPTY_AMOUNT,
  );
  const [includeNetWorth, setIncludeNetWorth] = useState(
    account?.includeNetWorth ?? true,
  );
  const [includeLiquid, setIncludeLiquid] = useState(
    account?.includeLiquid ?? defaultIncludeLiquid(account?.group ?? "savings"),
  );
  const [bucketId, setBucketId] = useState(account?.bucketId ?? "");
  const [statementDay, setStatementDay] = useState(
    account?.statementDay != null ? String(account.statementDay) : "",
  );
  const [dueDay, setDueDay] = useState(account?.dueDay != null ? String(account.dueDay) : "");
  const [maturityDate, setMaturityDate] = useState(account?.maturityDate ?? "");
  const [notes, setNotes] = useState(account?.notes ?? "");
  const [virtualKind, setVirtualKind] = useState<VirtualKind>(
    account?.virtualKind ?? "external",
  );
  const [amountTarget, setAmountTarget] = useState<AmountTarget>("opening");

  const type = typeForAccountGroup(group);
  const showLimit = group === "credit_card";
  const showVirtual = type === "virtual";
  const showMaturity = group === "fd";

  function onGroup(next: AccountGroup) {
    setGroup(next);
    if (mode === "add") {
      setIncludeLiquid(defaultIncludeLiquid(next));
      setIncludeNetWorth(typeForAccountGroup(next) !== "virtual");
    }
  }

  function onKey(key: AmountKey) {
    if (amountTarget === "limit") setLimit((d) => applyAmountKey(d, key));
    else setOpening((d) => applyAmountKey(d, key));
  }

  function parseDay(raw: string): number | null {
    const t = raw.trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > 31) return null;
    return n;
  }

  const nameOk = name.trim() !== "";
  const dateOk = mode === "edit" || isIsoDate(openingDate);
  const canSave = nameOk && dateOk && !saving;

  function save() {
    if (!canSave) return;
    if (mode === "add") {
      onSaveAdd({
        name: name.trim(),
        group,
        openingBalance: amountPaise(opening),
        openingDate: isIsoDate(openingDate) ? openingDate : today,
        creditLimit: showLimit ? amountPaise(limit) : null,
        includeNetWorth,
        includeLiquid,
        bucketId: bucketId || null,
        statementDay: parseDay(statementDay),
        dueDay: parseDay(dueDay),
        notes,
        virtualKind: showVirtual ? virtualKind : null,
        maturityDate: showMaturity && isIsoDate(maturityDate) ? maturityDate : null,
      });
      return;
    }
    onSaveEdit({
      name: name.trim(),
      creditLimit: showLimit ? amountPaise(limit) : undefined,
      includeNetWorth,
      includeLiquid,
      bucketId: bucketId || null,
      statementDay: parseDay(statementDay),
      dueDay: parseDay(dueDay),
      notes,
      maturityDate: showMaturity ? (isIsoDate(maturityDate) ? maturityDate : null) : undefined,
    });
  }

  const keypadDraft = amountTarget === "limit" ? limit : opening;
  const keypadLabel = amountTarget === "limit" ? "Credit limit" : "Opening";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <label className="block">
          <span className="kicker">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="HDFC Savings"
            className="mt-1 field"
          />
        </label>

        {mode === "add" ? (
          <>
            <p className="mt-4 mb-2 kicker">
              Group
            </p>
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_GROUP_ORDER.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={chipClass(group === g)}
                  onClick={() => onGroup(g)}
                >
                  {ACCOUNT_GROUP_LABELS[g]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Type is {type}
              {showVirtual ? " · pick the virtual kind" : ""}.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">
            {ACCOUNT_GROUP_LABELS[group]} · {type}. Opening stays {formatInr(account?.openingBalance ?? 0)} on{" "}
            {account?.openingDate}. Balances are calculated.
          </p>
        )}

        {showVirtual && mode === "add" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {(["employer", "external", "expense"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={chipClass(virtualKind === kind)}
                onClick={() => setVirtualKind(kind)}
              >
                {kind === "employer" ? "Employer" : kind === "external" ? "External" : "Expense"}
              </button>
            ))}
          </div>
        ) : null}

        {mode === "add" ? (
          <label className="mt-4 block">
            <span className="kicker">
              Opening date
            </span>
            <input
              type="date"
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
              className="mt-1 field"
            />
          </label>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={chipClass(includeNetWorth)}
            onClick={() => setIncludeNetWorth((v) => !v)}
          >
            Net worth
          </button>
          <button
            type="button"
            className={chipClass(includeLiquid)}
            onClick={() => setIncludeLiquid((v) => !v)}
          >
            Liquid
          </button>
        </div>

        {buckets.length > 0 ? (
          <>
            <p className="mt-4 mb-2 kicker">
              Bucket
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={chipClass(bucketId === "")}
                onClick={() => setBucketId("")}
              >
                None
              </button>
              {buckets.map((bucket) => (
                <button
                  key={bucket.id}
                  type="button"
                  className={chipClass(bucketId === bucket.id)}
                  onClick={() => setBucketId(bucket.id)}
                >
                  {bucket.name}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {showLimit ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <label>
              <span className="kicker">
                Statement day
              </span>
              <input
                inputMode="numeric"
                value={statementDay}
                onChange={(e) => setStatementDay(e.target.value)}
                placeholder="17"
                className="mt-1 field"
              />
            </label>
            <label>
              <span className="kicker">
                Due day
              </span>
              <input
                inputMode="numeric"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                placeholder="7"
                className="mt-1 field"
              />
            </label>
          </div>
        ) : null}

        {showMaturity ? (
          <label className="mt-4 block">
            <span className="kicker">
              Maturity date
            </span>
            <input
              type="date"
              value={maturityDate}
              onChange={(e) => setMaturityDate(e.target.value)}
              className="mt-1 field"
            />
          </label>
        ) : null}

        <label className="mt-4 block">
          <span className="kicker">Note</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 field"
          />
        </label>

        {mode === "add" || showLimit ? (
          <div className="mt-4">
            <div className="flex gap-2">
              {mode === "add" ? (
                <button
                  type="button"
                  className={chipClass(amountTarget === "opening")}
                  onClick={() => setAmountTarget("opening")}
                >
                  Opening {formatInr(amountPaise(opening))}
                </button>
              ) : null}
              {showLimit ? (
                <button
                  type="button"
                  className={chipClass(amountTarget === "limit")}
                  onClick={() => setAmountTarget("limit")}
                >
                  Limit {formatInr(amountPaise(limit))}
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
              {keypadLabel} {amountExpression(keypadDraft) || "0"}
            </p>
          </div>
        ) : null}
      </div>

      {mode === "add" || showLimit ? (
        <div className="shrink-0 pt-2">
          <Keypad onKey={onKey} />
        </div>
      ) : null}

      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="mt-3 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add account" : "Save"}
      </button>
    </div>
  );
}
