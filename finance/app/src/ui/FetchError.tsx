import { laptopErrorText } from "./copy.ts";

export function FetchError({
  error,
  onRetry,
  compact = false,
}: {
  error: unknown;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "pb-4" : "py-8"}>
      <p className="text-sm text-danger">{laptopErrorText(error)}</p>
      <button type="button" className="btn-primary mt-3 rounded-full text-sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
