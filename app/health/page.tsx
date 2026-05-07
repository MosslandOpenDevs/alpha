import { getSystemHealth, fmtKst, fmtAge, type Status } from "@/lib/health";
import { SITE } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata: Metadata = {
  title: "System Freshness — Alpha by Mossland",
  description:
    "Alpha 의 모든 데이터 subsystem 의 마지막 갱신 시각. 매크로, brief, 페르소나, 합성, why-moved 등.",
  alternates: { canonical: `${SITE.baseUrl}/health` },
  robots: { index: false, follow: false },
};

const STATUS_STYLE: Record<Status, { dot: string; label: string }> = {
  ok:   { dot: "bg-emerald-500", label: "OK" },
  warn: { dot: "bg-amber-400",   label: "WARN" },
  fail: { dot: "bg-rose-500",    label: "FAIL" },
  info: { dot: "bg-zinc-400",    label: "INFO" },
};

export default function HealthPage() {
  const health = getSystemHealth();
  const top = STATUS_STYLE[health.worstStatus];

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Health</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2 flex items-baseline gap-3">
          System freshness
          <span
            className={`inline-flex items-center gap-2 text-sm font-mono px-2.5 py-1 rounded-full bg-zinc-50 border border-[var(--line)]`}
          >
            <span className={`w-2 h-2 rounded-full ${top.dot}`} />
            {top.label}
          </span>
        </h1>
        <p className="text-sm text-zinc-700 leading-relaxed">
          Alpha 의 데이터 subsystem 별 마지막 갱신 시각. 운영 / 디버깅 용. JSON
          버전: <a href="/api/health" className="text-[var(--moss)] hover:underline">/api/health</a>
        </p>
        <p className="mt-2 text-xs text-[var(--muted)] font-mono">
          checked at {fmtKst(health.generatedAt)}
        </p>
      </header>

      <section className="mb-8">
        <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--muted)] uppercase tracking-wider bg-zinc-50">
              <tr>
                <th className="text-left px-4 py-2.5"></th>
                <th className="text-left px-4 py-2.5">Subsystem</th>
                <th className="text-left px-4 py-2.5">Last update</th>
                <th className="text-left px-4 py-2.5">Age</th>
                <th className="text-left px-4 py-2.5">Cadence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {health.subsystems.map((s) => {
                const st = STATUS_STYLE[s.status];
                return (
                  <tr key={s.key}>
                    <td className="px-4 py-2.5 align-top">
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full ${st.dot}`}
                        title={st.label}
                      />
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <div className="font-medium text-zinc-900">{s.label}</div>
                      {s.latestDate && (
                        <div className="text-[11px] text-[var(--muted)] font-mono">
                          latest record: {s.latestDate.slice(0, 10)}
                        </div>
                      )}
                      {s.note && (
                        <div className="text-[11px] text-zinc-500 mt-1 leading-snug">
                          {s.note}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top font-mono text-xs">
                      {fmtKst(s.lastAt)}
                    </td>
                    <td className="px-4 py-2.5 align-top font-mono text-xs">
                      {fmtAge(s.ageSec)}
                    </td>
                    <td className="px-4 py-2.5 align-top text-xs text-zinc-600">
                      {s.cadence}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6 text-xs text-[var(--muted)] leading-relaxed">
        <p>
          <strong>Threshold:</strong> 각 subsystem 별로 OK / WARN / FAIL 임계값
          (시간) 이 다름 — daily cron 은 보통 28h WARN / 50h FAIL, weekly 는 더
          긴 임계값.
        </p>
        <p className="mt-2">
          <strong>Cron 시각은 모두 KST 기준.</strong> PM2 가 시스템 local time
          으로 cron 실행 (alpha 운영 머신은 KST). 이전엔 UTC 가정으로 잘못
          작성돼서 9시간 일찍 firing 했었음 — 2026-05-07 fix.
        </p>
      </section>

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>운영: Mossland</span>
        <span className="mx-2">·</span>
        <span>Source: <a href="https://github.com/MosslandOpenDevs/alpha/blob/main/lib/health.ts" className="hover:text-[var(--fg)]">lib/health.ts</a></span>
        <span className="mx-2">·</span>
        <span>JSON: /api/health</span>
      </footer>
    </main>
  );
}
