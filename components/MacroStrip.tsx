import {
  MACRO_SERIES,
  getLatestObservation,
  getRecentObservations,
  changeFromPrevious,
} from "@/lib/fred";
import { KR_MACRO_SERIES } from "@/lib/ecos";

type MergedSeries = {
  id: string;
  label: string;
  unit: string;
  description: string;
};

/**
 * Macro 한 줄 strip — 미국(FRED) + 한국(ECOS) 핵심 chip.
 * 홈 + asset/btc 등에 노출.
 */
export function MacroStrip({
  seriesIds = ["DFF", "KR_BASE_RATE", "DGS10", "KR_GOV3Y", "DEXKOUS", "T10Y2Y"],
}: {
  seriesIds?: string[];
}) {
  const allSeries: MergedSeries[] = [
    ...MACRO_SERIES.map((s) => ({
      id: s.id,
      label: s.label,
      unit: s.unit,
      description: s.description,
    })),
    ...KR_MACRO_SERIES.map((s) => ({
      id: s.id,
      label: s.label,
      unit: s.unit,
      description: s.description,
    })),
  ];

  const items = seriesIds
    .map((id) => {
      const series = allSeries.find((s) => s.id === id);
      if (!series) return null;
      const latest = getLatestObservation(id);
      if (!latest || latest.value == null) return null;
      const recent = getRecentObservations(id, 2);
      const change = changeFromPrevious(series, recent);
      return { series, latest, change };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  if (items.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2 flex items-center gap-2">
        매크로 한 컷
        <span className="text-[10px] normal-case font-normal text-[var(--muted)]">
          (FRED · 자동 갱신)
        </span>
      </h2>
      <div className="flex flex-wrap gap-2">
        {items.map(({ series, latest, change }) => {
          const isUp = (change?.delta ?? 0) > 0;
          const isDown = (change?.delta ?? 0) < 0;
          return (
            <div
              key={series.id}
              className="rounded-2xl border border-[var(--line)] bg-white px-3 py-2 min-w-[140px]"
              title={series.description}
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                {series.label}
              </div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-mono text-base font-semibold">
                  {fmt(latest.value!, series.unit)}
                </span>
                {change && (
                  <span
                    className={`text-[10px] font-mono ${
                      isUp ? "text-[var(--bull)]" : isDown ? "text-[var(--bear)]" : "text-[var(--muted)]"
                    }`}
                  >
                    {isUp ? "+" : ""}
                    {change.delta.toFixed(2)}
                    {change.deltaUnit}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-[var(--muted)] mt-0.5">
                {latest.date}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function fmt(value: number, unit: string): string {
  if (unit === "%" || unit === "%p") return value.toFixed(2) + "%";
  if (unit === "KRW") return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  if (unit === "index") return value.toFixed(2);
  return value.toString();
}
