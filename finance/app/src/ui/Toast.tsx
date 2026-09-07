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
      className="absolute left-4 right-4 top-[max(0.75rem,env(safe-area-inset-top))] z-50 rounded-2xl bg-ink px-4 py-3 text-sm font-medium tabular-nums text-app shadow-lg"
    >
      {message}
    </div>
  );
}
