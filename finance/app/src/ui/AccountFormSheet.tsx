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
import {
  AmountField,
  chipClass,
  FieldLabel,
  FormSelect,
  namedOptions,
} from "./formFields.tsx";
import {
  ACCOUNT_GROUP_LABELS,
  ACCOUNT_GROUP_ORDER,
} from "./accounts.ts";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  amountPaise,
  EMPTY_AMOUNT,
  type AmountDraft,
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

const VIRTUAL_KIND_OPTIONS = [
  { value: "employer", label: "Employer" },
  { value: "external", label: "External" },
  { value: "expense", label: "Expense" },
] as const;

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

  return (
    <div className="pb-1">
      <div className="space-y-4">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="HDFC Savings"
            className="mt-1 field"
          />
        </label>

        {mode === "add" ? (
          <>
            <FormSelect
              label="Group"
              value={group}
              onChange={(v) => onGroup(v as AccountGroup)}
              options={ACCOUNT_GROUP_ORDER.map((g) => ({
                value: g,
                label: ACCOUNT_GROUP_LABELS[g],
              }))}
            />
            <p className="-mt-2 text-xs text-muted">
              Type is {type}
              {showVirtual ? " · pick the virtual kind" : ""}.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            {ACCOUNT_GROUP_LABELS[group]} · {type}. Opening stays {formatInr(account?.openingBalance ?? 0)} on{" "}
            {account?.openingDate}. Balances are calculated.
          </p>
        )}

        {showVirtual && mode === "add" ? (
          <FormSelect
            label="Virtual kind"
            value={virtualKind}
            onChange={(v) => setVirtualKind(v as VirtualKind)}
            options={[...VIRTUAL_KIND_OPTIONS]}
          />
        ) : null}

        {mode === "add" ? (
          <label className="block">
            <FieldLabel>Opening date</FieldLabel>
            <input
              type="date"
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
              className="mt-1 field"
            />
          </label>
        ) : null}

        <div className="flex flex-wrap gap-2">
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
          <FormSelect
            label="Bucket"
            value={bucketId}
            onChange={setBucketId}
            options={[{ value: "", label: "None" }, ...namedOptions(buckets)]}
          />
        ) : null}

        {showLimit ? (
          <div className="grid grid-cols-2 gap-2">
            <label>
              <FieldLabel>Statement day</FieldLabel>
              <input
                inputMode="numeric"
                value={statementDay}
                onChange={(e) => setStatementDay(e.target.value)}
                placeholder="17"
                className="mt-1 field"
              />
            </label>
            <label>
              <FieldLabel>Due day</FieldLabel>
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
          <label className="block">
            <FieldLabel>Maturity date</FieldLabel>
            <input
              type="date"
              value={maturityDate}
              onChange={(e) => setMaturityDate(e.target.value)}
              className="mt-1 field"
            />
          </label>
        ) : null}

        <label className="block">
          <FieldLabel>Note</FieldLabel>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 field"
          />
        </label>

        {mode === "add" ? (
          <AmountField label="Opening" amount={opening} onChange={setOpening} plus={false} />
        ) : null}
        {showLimit ? (
          <AmountField label="Credit limit" amount={limit} onChange={setLimit} plus={false} />
        ) : null}
      </div>

      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add account" : "Save"}
      </button>
    </div>
  );
}
