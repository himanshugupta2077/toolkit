import { useEffect } from "react";

type ToastProps = {
  message: string | null;
  onDismiss: () => void;
};

export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDismiss, 3500);
    return () => window.clearTimeout(id);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-4 left-4 z-50 rounded-2xl bg-ink px-4 py-3 text-sm font-medium tabular-nums text-app shadow-lg desk:top-6 desk:right-8 desk:left-auto desk:w-auto desk:min-w-80 desk:max-w-md"
    >
      {message}
    </div>
  );
}
