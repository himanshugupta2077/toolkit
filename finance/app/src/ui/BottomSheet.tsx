import { useEffect, type ReactNode } from "react";

type BottomSheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Nearly full-height sheet so a keypad can sit at the bottom. */
  tall?: boolean;
};

export function BottomSheet({
  open,
  title,
  onClose,
  children,
  tall = false,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const titleId = "bottom-sheet-title";

  return (
    <div className="absolute inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-overlay"
        aria-label="Dismiss"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`sheet-frame absolute inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[1.75rem] border-t border-line bg-sheet shadow-[0_-12px_40px_rgba(0,0,0,0.25)] ${
          tall ? "sheet-tall h-[min(92dvh,760px)]" : "max-h-[min(92dvh,760px)]"
        }`}
      >
        <div className="shrink-0 px-5 pt-2.5">
          <div className="sheet-handle mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" />
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="btn-close -mr-3">
              Close
            </button>
          </div>
        </div>
        <div
          className={`min-h-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] ${
            tall ? "flex flex-1 flex-col overflow-hidden" : "overflow-y-auto"
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
