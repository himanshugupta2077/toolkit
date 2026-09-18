import type { NetWorthHistoryPoint } from "../api/store.ts";
import { formatInr } from "../engine/index.ts";
import { Amount } from "./Privacy.tsx";
import {
  chartDateLabel,
  netWorthPlotPoints,
  netWorthTrendCaption,
  netWorthYDomain,
} from "./wealth.ts";

const W = 640;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 8, left: 8 };

export function NetWorthSparkline({
  points,
  label = "Net worth history",
}: {
  points: readonly NetWorthHistoryPoint[];
  label?: string;
}) {
  if (points.length < 2) {
    return (
      <p className="mt-2 text-sm text-muted">
        Trend appears after two snapshot days.
      </p>
    );
  }

  const domain = netWorthYDomain(points.map((row) => row.netWorth));
  const coords = netWorthPlotPoints(points, domain);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xy = coords.map((pt) => ({
    x: PAD.left + pt.x * plotW,
    y: PAD.top + pt.y * plotH,
  }));
  const line = xy
    .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(" ");
  const last = xy[xy.length - 1];
  const first = xy[0];
  const area =
    first && last
      ? `${line} L${last.x.toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L${first.x.toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`
      : "";
  const midY = PAD.top + plotH / 2;
  const trend = netWorthTrendCaption(points);
  const start = points[0];
  const end = points[points.length - 1];
  const rising = end != null && start != null && end.netWorth >= start.netWorth;

  return (
    <div className="mt-3">
      {trend ? (
        <p className="text-sm text-muted">
          <Amount>{trend}</Amount>
        </p>
      ) : null}
      <div className="mt-2 flex gap-3">
        <div className="flex shrink-0 flex-col justify-between py-0.5 text-[11px] tabular-nums text-muted">
          <Amount>{formatInr(domain.max)}</Amount>
          <Amount>{formatInr(domain.min)}</Amount>
        </div>
        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className={`h-36 w-full desk:h-48 ${rising ? "text-accent" : "text-danger"}`}
            role="img"
            aria-label={label}
            preserveAspectRatio="none"
          >
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top}
              y2={PAD.top}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={midY}
              y2={midY}
              stroke="var(--line)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + plotH}
              y2={PAD.top + plotH}
              stroke="var(--line)"
              strokeWidth="1"
            />
            {area ? (
              <path d={area} fill="currentColor" opacity="0.16" />
            ) : null}
            <path
              d={line}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          {start && end ? (
            <div className="mt-1 flex justify-between text-[11px] text-muted">
              <span>{chartDateLabel(start.date)}</span>
              <span>{chartDateLabel(end.date)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
