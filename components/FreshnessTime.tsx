/**
 * FreshnessTime — relative + absolute timestamp with age-based color.
 *
 * - Renders proper <time dateTime="..."> (good for SEO + screen readers).
 * - Hover shows absolute KST. Visible text is relative ("3시간 전", "5일 전").
 * - Color: <24h emerald, <7d zinc, ≥7d amber, ≥30d rose (signals staleness).
 *
 * Server component — no client JS shipped. Recomputes on every request.
 *
 * Usage:
 *   <FreshnessTime iso={topic.updatedAt} />
 *   <FreshnessTime iso={syn.generated_at} prefix="합성:" />
 */
import type { ReactNode } from "react";

type Props = {
  iso: string | null | undefined;
  prefix?: ReactNode;
  /** Smaller (xs) text. Default: same size as parent. */
  compact?: boolean;
};

function formatRelativeKo(then: Date, now: Date): string {
  const diffMs = now.getTime() - then.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return "방금";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  if (day < 30) return `${Math.floor(day / 7)}주 전`;
  if (day < 365) return `${Math.floor(day / 30)}개월 전`;
  return `${Math.floor(day / 365)}년 전`;
}

function colorClass(ageMs: number): string {
  const day = ageMs / 86400000;
  if (day < 1) return "text-emerald-600";
  if (day < 7) return "text-zinc-600";
  if (day < 30) return "text-amber-600";
  return "text-rose-600";
}

function formatKST(iso: string): string {
  // Force KST regardless of server tz.
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function FreshnessTime({ iso, prefix, compact }: Props) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const now = new Date();
  const ageMs = now.getTime() - then.getTime();
  const rel = formatRelativeKo(then, now);
  const abs = `${formatKST(iso)} KST`;
  const cls = `${colorClass(ageMs)} ${compact ? "text-[10px]" : ""}`.trim();
  return (
    <time dateTime={iso} title={abs} className={cls}>
      {prefix ? <span className="text-[var(--muted)] mr-1">{prefix}</span> : null}
      {rel}
    </time>
  );
}
