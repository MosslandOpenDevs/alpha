import { type DailyMover, fmtMoverPrice } from "@/lib/daily-mover";

/**
 * Daily movers strip — always-on 24h signal complement to pulses.
 *
 * Shown on the homepage above the existing pulse list. Pulses fire on
 * intra-day spikes (rare in calm markets); daily movers always show
 * what's moving over the past 24h, even if no spike crossed threshold.
 */
export function DailyMoversStrip({
  movers,
  fetchedAt,
}: {
  movers: DailyMover[];
  /** ISO of the *oldest* fetch in the batch — drives the staleness label. */
  fetchedAt: string | null;
}) {
  if (movers.length === 0) return null;

  return (
    <section className="mb-8">
      <header className="flex items-baseline gap-2 mb-3">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)]">
          오늘 24시간 변동
        </h2>
        <span className="text-[10px] text-[var(--muted)] font-mono">
          binance · yahoo · 5min cache
        </span>
        {fetchedAt && (
          <span className="ml-auto text-[10px] text-[var(--muted)] font-mono">
            {fmtFetchedRel(fetchedAt)}
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {movers.map((m) => {
          const up = m.changePct >= 0;
          const big = Math.abs(m.changePct) >= 1.0;
          const dirCls = up ? "text-[var(--bull)]" : "text-[var(--bear)]";
          return (
            <div
              key={m.asset}
              className={`rounded-xl border bg-white px-3 py-2.5 ${
                big ? "border-[var(--accent)]/30" : "border-[var(--line)]"
              }`}
              title={`${m.asset} · 이전 ${fmtMoverPrice({ current: m.previous, unit: m.unit })}`}
            >
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="font-mono text-xs uppercase font-bold">
                  {m.asset}
                </span>
                <span
                  className={`ml-auto font-mono text-xs font-bold ${dirCls}`}
                >
                  {up ? "+" : ""}
                  {m.changePct.toFixed(2)}%
                </span>
              </div>
              <div className="text-xs text-zinc-700 font-mono">
                {fmtMoverPrice(m)}
              </div>
              <div className="text-[10px] text-[var(--muted)] mt-0.5">
                {m.label}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function fmtFetchedRel(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
