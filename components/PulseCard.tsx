import type { Pulse } from "@/lib/mic";

const STATE_LABEL: Record<string, { ko: string; cls: string }> = {
  raw: { ko: "분석 중", cls: "bg-amber-50 text-amber-700" },
  pending: { ko: "분석 중", cls: "bg-amber-50 text-amber-700" },
  enriched: { ko: "보도 매칭됨", cls: "bg-blue-50 text-blue-700" },
  reviewed: { ko: "검수 완료", cls: "bg-green-50 text-green-700" },
};

function fmtUsd(n?: number) {
  if (n == null) return "";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

export function PulseCard({ pulse, compact }: { pulse: Pulse; compact?: boolean }) {
  const state = pulse.synthesisState
    ? STATE_LABEL[pulse.synthesisState]
    : null;
  const dirSign = pulse.direction === "up" ? "+" : "-";
  const dirCls =
    pulse.direction === "up" ? "text-[var(--bull)]" : "text-[var(--bear)]";

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <div className="flex items-center gap-2 text-xs text-[var(--muted)] mb-2">
        <span className="font-mono uppercase font-bold text-[var(--fg)]">
          {pulse.asset}
        </span>
        <span className={`font-mono font-bold ${dirCls}`}>
          {dirSign}{Math.abs(pulse.magnitudePct).toFixed(2)}%
        </span>
        <span>· {pulse.windowMinutes}분 윈도우</span>
        <span>· {timeAgo(pulse.detectedAt)}</span>
        {state && (
          <span
            className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium ${state.cls}`}
          >
            {state.ko}
          </span>
        )}
      </div>

      {pulse.priceFrom != null && pulse.priceTo != null && (
        <div className="mb-3 text-sm text-zinc-700 font-mono">
          {fmtUsd(pulse.priceFrom)} → {fmtUsd(pulse.priceTo)}
        </div>
      )}

      <p className={`text-sm text-zinc-700 leading-relaxed ${compact ? "line-clamp-3" : ""} mb-3`}>
        {pulse.summary}
      </p>

      {!compact && pulse.verifiedSummary && (
        <div className="mb-3 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
          <div className="font-semibold mb-1 text-zinc-700">사후 검증</div>
          {pulse.verifiedSummary}
        </div>
      )}

      {pulse.sources && pulse.sources.length > 0 && (
        <details className="text-xs text-[var(--muted)]" open={!compact}>
          <summary className="cursor-pointer text-[var(--moss)] hover:underline">
            출처 {pulse.sources.length}건
          </summary>
          <ul className="mt-2 space-y-1.5">
            {pulse.sources.slice(0, compact ? 2 : 8).map((s, i) => (
              <li key={i}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--moss)] hover:underline"
                >
                  {s.title || s.url}
                </a>
                {s.publisher && (
                  <span className="text-[var(--muted)]"> — {s.publisher}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
