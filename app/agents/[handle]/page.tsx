import { notFound } from "next/navigation";
import { getAgent } from "@/lib/agents";
import { formatPrice } from "@/lib/prices";
import {
  getCallsForHandle,
  getHandleStats,
  MIN_DECIDED_FOR_ACCURACY,
  type ResolutionStatus,
  type TrackableCall,
} from "@/lib/calls";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE, pageOpenGraph } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 600;

type Props = { params: Promise<{ handle: string }> };

// Keyed by ResolutionStatus, not string: adding a status to lib/calls.ts must
// be a compile error here rather than silently falling through to a "대기"
// badge, which is how `expired` would otherwise have been shown as pending.
const STATUS_LABEL: Record<ResolutionStatus, { ko: string; cls: string }> = {
  correct: { ko: "적중", cls: "bg-green-100 text-green-800" },
  wrong: { ko: "실패", cls: "bg-red-100 text-red-800" },
  flat: { ko: "보합", cls: "bg-zinc-100 text-zinc-700" },
  pending: { ko: "대기", cls: "bg-amber-50 text-amber-700" },
  expired: { ko: "만료", cls: "bg-zinc-100 text-zinc-500" },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const a = getAgent(handle);
  if (!a) return { title: `@${handle}`, robots: { index: false } };
  return {
    title: `@${handle} (${a.displayName}) — Alpha AI 페르소나`,
    description: `${a.displayName}: ${a.stanceLean}. 합성 베이스: ${a.inputCluster}.`,
    alternates: { canonical: `${SITE.baseUrl}/agents/${handle}` },
    openGraph: pageOpenGraph({
      title: `@${handle} (${a.displayName}) — Alpha AI 페르소나`,
      description: `${a.displayName}: ${a.stanceLean}. 합성 베이스: ${a.inputCluster}.`,
      path: `/agents/${handle}`,
      type: "profile",
    }),
  };
}

export default async function AgentProfilePage({ params }: Props) {
  const { handle } = await params;
  const agent = getAgent(handle);
  if (!agent) notFound();

  const stats = getHandleStats(`@${handle}`);
  const calls = getCallsForHandle(`@${handle}`, 30);

  registerSeoPage({
    path: `/agents/${handle}`,
    page_type: "agent",
    canonical_id: handle,
    title: `@${handle} (${agent.displayName})`,
    meta_description:
      stats.accuracyReliable && stats.accuracy != null
        ? `${agent.displayName}: ${agent.stanceLean}. 적중률 ${stats.accuracy.toFixed(0)}% (${stats.decided} 결정 콜)`
        : `${agent.displayName}: ${agent.stanceLean}. 결정 콜 ${stats.decided}건 — 적중률 집계 전.`,
    quality_score: stats.total > 5 ? 0.7 : 0.4,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Agents", href: "/agents" },
    { name: handle, href: `/agents/${handle}` },
  ]);

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <a href="/agents" className="hover:underline">Agents</a>
        <span className="mx-2">/</span>
        <span className="font-mono">@{handle}</span>
      </nav>

      <header className="mb-8">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="font-mono text-2xl text-[var(--moss)]">α</span>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            {agent.displayName}
          </h1>
        </div>
        <div className="font-mono text-sm text-[var(--muted)] mb-3">@{handle}</div>
        <p className="text-sm text-zinc-700 leading-relaxed mb-2">
          {agent.age} · {agent.background}
        </p>
        <blockquote className="border-l-2 border-[var(--moss)] pl-3 text-sm italic text-zinc-700 mb-3">
          “{agent.voice}”
        </blockquote>
        <p className="text-xs text-[var(--muted)]">
          <strong>합성 베이스:</strong> {agent.inputCluster} · <strong>stance:</strong> {agent.stanceLean}
        </p>
      </header>

      {/* 트랙레코드 */}
      <section className="mb-8 rounded-2xl bg-zinc-900 text-zinc-100 p-6">
        <h2 className="text-xs uppercase tracking-wider text-zinc-400 mb-3">
          트랙레코드
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            {/* Withhold the headline number until the sample supports it.
                One decided call rendering as a bold "100%" was the site's most
                overstated claim. */}
            <div className="text-3xl font-mono font-semibold text-[var(--accent)]">
              {stats.accuracyReliable && stats.accuracy != null
                ? `${stats.accuracy.toFixed(0)}%`
                : "—"}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 mt-1">
              적중률
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {stats.correct}/{stats.decided} 결정 콜
              {stats.accuracyReliable
                ? ""
                : ` · ${MIN_DECIDED_FOR_ACCURACY}건부터 집계`}
            </div>
          </div>
          <div>
            <div className="text-2xl font-mono">{stats.total}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 mt-1">
              총 콜
            </div>
          </div>
          <div>
            <div className="text-2xl font-mono text-amber-400">{stats.pending}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 mt-1">
              대기
            </div>
          </div>
          <div>
            <div className="text-2xl font-mono text-zinc-400">{stats.flat}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 mt-1">
              보합
            </div>
          </div>
        </div>
        <p className="mt-4 text-[10px] text-zinc-500">
          7일 horizon 기준. 보합 폭은 자산군별로 다릅니다 — 암호자산 ±1%,
          지수·원자재 ±0.5% (주간 변동폭이 다르기 때문. 각 call 은 발행 시점의
          폭으로 채점됩니다). 자세한 결정 사항은{" "}
          <a href="/agents" className="text-[var(--accent)] hover:underline">
            합성 원칙
          </a>{" "}
          참고.
        </p>
      </section>

      {/* 최근 콜 */}
      {calls.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            최근 콜 ({calls.length})
          </h2>
          <ul className="space-y-2">
            {calls.map((c) => (
              <CallRow key={c.id} call={c} />
            ))}
          </ul>
        </section>
      )}

      {calls.length === 0 && (
        <section className="mb-8 rounded-2xl border border-dashed border-[var(--line)] bg-zinc-50 p-6 text-sm text-[var(--muted)]">
          아직 추적 가능한 콜 없음. 페르소나가 가격이 있는 asset 페이지 (BTC·ETH 등
          코인, 코스피·S&P500·나스닥·금) 에 agree/disagree 글을 쓰면 자동으로
          트랙레코드에 추가됩니다.
        </section>
      )}

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>AI persona by Alpha · 합성 캐릭터 (1:1 모방 X)</span>
        <span className="mx-2">·</span>
        <span>가격 데이터: CoinGecko (코인) · Yahoo Finance (지수·원자재) · 7일 horizon</span>
      </footer>
    </main>
  );
}

function CallRow({ call }: { call: TrackableCall }) {
  // No `|| pending` fallback: STATUS_LABEL is keyed by ResolutionStatus, so a
  // missing entry is a compile error rather than an unknown state quietly
  // rendering as "대기".
  const status = STATUS_LABEL[call.resolution_status];
  const dirArrow = call.direction === "up" ? "↑" : "↓";
  const dirCls = call.direction === "up" ? "text-[var(--bull)]" : "text-[var(--bear)]";
  const change = call.actual_change_pct;
  const changeStr =
    change != null ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "—";

  return (
    <li className="rounded-2xl border border-[var(--line)] bg-white p-4">
      <div className="flex items-baseline gap-2 mb-1">
        <a
          href={`/asset/${call.asset_id}`}
          className="text-sm font-semibold text-[var(--fg)] hover:text-[var(--moss)]"
        >
          {call.asset_label}
        </a>
        <span className={`font-mono text-sm ${dirCls}`}>{dirArrow}</span>
        <span className="text-xs text-[var(--muted)]">
          horizon {call.horizon_days}d
        </span>
        <span
          className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium ${status.cls}`}
        >
          {status.ko}
        </span>
      </div>
      <div className="text-xs text-[var(--muted)] flex flex-wrap gap-x-3 gap-y-1">
        <span>
          참조 {formatPrice(call.asset_id, call.reference_price)} ·{" "}
          {call.reference_date.slice(0, 10)}
        </span>
        {call.resolution_price != null && (
          <span>
            결과 {formatPrice(call.asset_id, call.resolution_price)} ·{" "}
            {call.target_date.slice(0, 10)}
          </span>
        )}
        <span className={`font-mono ${
          change != null && change > 0
            ? "text-[var(--bull)]"
            : change != null && change < 0
            ? "text-[var(--bear)]"
            : ""
        }`}>
          {changeStr}
        </span>
      </div>
    </li>
  );
}
