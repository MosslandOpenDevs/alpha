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
    <main id="main" className="mx-auto w-full max-w-4xl px-6 py-10">
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
          버전: <a href="/api/health" className="text-[var(--moss)] hover:underline">/api/health?detail=1</a>
        </p>
        <p className="mt-2 text-xs text-[var(--muted)] font-mono">
          checked at {fmtKst(health.generatedAt)}
        </p>
      </header>

      {/* LLM cost budget */}
      <section className="mb-8">
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  STATUS_STYLE[health.costBudget.status].dot
                }`}
              />
              Today's LLM cost budget
            </h2>
            <span className="text-xs text-[var(--muted)] font-mono">
              {health.costBudget.day} KST
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-2 font-mono">
            <span className="text-2xl font-semibold">
              ${health.costBudget.costUsd.toFixed(4)}
            </span>
            <span className="text-sm text-[var(--muted)]">
              / ${health.costBudget.capUsd.toFixed(2)} cap
            </span>
            <span className="ml-auto text-xs text-[var(--muted)]">
              {health.costBudget.callCount} calls today
            </span>
          </div>
          <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
            <div
              className={`h-full ${
                health.costBudget.status === "fail"
                  ? "bg-rose-500"
                  : health.costBudget.status === "warn"
                  ? "bg-amber-400"
                  : "bg-emerald-500"
              }`}
              style={{
                width: `${Math.min(100, health.costBudget.utilization * 100).toFixed(1)}%`,
              }}
            />
          </div>
          <div className="mt-3 flex items-baseline gap-2 border-t border-[var(--line)] pt-3 font-mono text-sm">
            <span className="text-[var(--muted)]">Grok 총지출 (전체 호출자)</span>
            <span className="font-semibold">
              ${health.costBudget.pipelineCostUsd.toFixed(4)}
            </span>
            <span className="ml-auto text-xs text-[var(--muted)]">
              {health.costBudget.pipelineRunCount} runs today
            </span>
          </div>
          <p className="mt-3 text-xs text-[var(--muted)] leading-relaxed">
            위 막대는 <strong>사용자 대면</strong> paid endpoint (/api/ask · /api/mcp
            ask_alpha) 의 글로벌 일일 cap 입니다. 초과 시 503, KST 자정에 reset,
            개별 IP 는 별도 per-minute / per-day token bucket (lib/rate-limit.ts).
            cron 파이프라인 지출은 cap 에 포함되지 않습니다 — 무인 작업이 실제
            방문자의 /api/ask 를 막으면 안 되기 때문입니다. 아래 줄은 오늘
            비캐시 Grok 호출의 <strong>전체</strong> 합계라 위 막대와 일부
            겹칩니다 (alpha_ai_runs 에 호출자 구분이 없음) — 두 값을 더하지
            마세요. 주간 OpenAI citation audit 은 별도 과금이라 미포함입니다.
          </p>
        </div>
      </section>

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
          <strong>위 cadence 는 KST 표기, 실제 스케줄은 UTC.</strong> PM2 는
          데몬의 local timezone 으로 cron 을 평가하고 운영 호스트는{" "}
          <code className="font-mono">Etc/UTC</code> 라, ecosystem.config.cjs 의
          표현식은 UTC 로 쓰여 있고 주석이 대응 KST 시각을 명시합니다.
          2026-05-07 에 호스트를 KST 로 오인해 전 스케줄을 9시간 옮긴 적이
          있어, 지금은 <code className="font-mono">timedatectl</code> 로 확인한
          값을 기준으로 합니다.
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
