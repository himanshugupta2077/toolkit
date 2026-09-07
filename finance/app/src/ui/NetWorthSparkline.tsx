import type { NetWorthHistoryPoint } from "../api/store.ts";
import { sparklinePoints } from "./portfolio.ts";

export function NetWorthSparkline({
  points,
  label = "Net worth history",
}: {
  points: readonly NetWorthHistoryPoint[];
  label?: string;
}) {
  if (points.length < 2) {
    return (
      <p className="mt-2 text-xs text-muted">
        History needs two snapshot days. Allocate or tap Snapshot.
      </p>
    );
  }
  const coords = sparklinePoints(points);
  const w = 240;
  const h = 56;
  const pad = 4;
  const path = coords
    .map((pt, i) => {
      const x = pad + pt.x * (w - pad * 2);
      const y = pad + pt.y * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mt-2 h-14 w-full text-accent"
      role="img"
      aria-label={label}
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
