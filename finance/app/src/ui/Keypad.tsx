import type { AmountKey } from "./quickAdd.ts";

const ROWS: AmountKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
];

function labelFor(key: AmountKey): string {
  if (key === "back") return "Backspace";
  if (key === ".") return "Decimal point";
  if (key === "+") return "Add";
  return key;
}

type KeypadProps = {
  onKey: (key: AmountKey) => void;
  plus?: boolean;
};

export function Keypad({ onKey, plus = true }: KeypadProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ROWS.flat().map((key) => (
        <button
          type="button"
          key={key}
          aria-label={labelFor(key)}
          onClick={() => onKey(key)}
          className="min-h-12 rounded-2xl bg-card-2 text-2xl font-medium tabular-nums text-ink transition-colors active:bg-line"
        >
          {key === "back" ? "⌫" : key}
        </button>
      ))}
      {plus ? (
        <button
          type="button"
          aria-label="Add"
          onClick={() => onKey("+")}
          className="col-span-3 min-h-11 rounded-2xl border border-line-strong bg-card text-lg font-medium text-ink transition-colors active:bg-card-2"
        >
          +
        </button>
      ) : null}
    </div>
  );
}
