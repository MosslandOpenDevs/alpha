import {
  getActivePulses,
  getAssetEntities,
  getAllTopics,
  getAllEvents,
  getAllEntities,
  assetSlugFromEntity,
} from "@/lib/mic";
import { upsertSeoPage } from "@/lib/db";
import { SITE } from "@/lib/seo";
import { PulseCard } from "@/components/PulseCard";
import { MacroStrip } from "@/components/MacroStrip";
import { DailyMoversStrip } from "@/components/DailyMoversStrip";
import { FreshnessTime } from "@/components/FreshnessTime";
import { getDailyMovers } from "@/lib/daily-mover";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const KST_OFFSET_MS = 9 * 3600_000;

function todayKST(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export default async function Home() {
  upsertSeoPage({
    path: "/",
    page_type: "home",
    canonical_id: null,
    title: `${SITE.longName} — 오늘의 알파, 모든 시각으로`,
    meta_description: SITE.description,
    index_policy: "index",
    lastmod: new Date().toISOString(),
    generated_at: new Date().toISOString(),
    quality_score: 0.7,
  });

  const activePulses = getActivePulses(48);
  // Daily movers — 24h |Δ| per asset. Always-on signal complement to
  // pulses. Fetched server-side; cached 5min via SQLite.
  const dailyMovers = await getDailyMovers({ allowStale: true });
  const oldestFetchAt = dailyMovers.reduce<string | null>((acc, m) => {
    if (!acc) return m.fetchedAt;
    return Date.parse(m.fetchedAt) < Date.parse(acc) ? m.fetchedAt : acc;
  }, null);
  const assets = getAssetEntities()
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 12);
  const topics = getAllTopics()
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 10);
  const events = getAllEvents()
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 8);
  const totalEntities = getAllEntities().length;

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-6 py-10 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
          오늘의 알파, 모든 시각으로
        </h1>
        <p className="text-base sm:text-lg leading-relaxed text-zinc-700">
          크립토·매크로·국제정세를 한국 유튜브·뉴스 채널 단위로 정리한
          미디어 커뮤니티. 현재 엔티티{" "}
          <span className="font-mono">{totalEntities}</span>개, 토픽{" "}
          <span className="font-mono">{getAllTopics().length}</span>개, 이벤트{" "}
          <span className="font-mono">{getAllEvents().length}</span>개,
          활성 펄스{" "}
          <span className="font-mono">{activePulses.length}</span>건.
        </p>
        <div className="mt-4 flex items-center gap-3 text-sm">
          <a
            href={`/brief/${todayKST()}`}
            className="rounded-full bg-[var(--moss)] text-white px-4 py-1.5 hover:opacity-90"
          >
            오늘 브리프 ▸
          </a>
          <a
            href="/pulse"
            className="rounded-full border border-[var(--line)] bg-white px-4 py-1.5 hover:border-[var(--moss)]"
          >
            Pulse ({activePulses.length})
          </a>
        </div>
      </header>

      {/* Macro Strip */}
      <MacroStrip />

      {/* Daily movers — 24h Δ per asset. Always-on, complements pulses. */}
      <DailyMoversStrip movers={dailyMovers} fetchedAt={oldestFetchAt} />

      {/* 활성 Pulse */}
      {activePulses.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
            지금 움직이는 가격 시그널
            <a
              href="/pulse"
              className="ml-auto text-[10px] normal-case font-normal text-[var(--moss)] hover:underline tracking-normal"
            >
              모두 보기 ▸
            </a>
          </h2>
          <div className="space-y-3">
            {activePulses.slice(0, 3).map((p) => (
              <PulseCard key={p.id} pulse={p} compact />
            ))}
          </div>
        </section>
      )}

      {/* 자산 grid */}
      {assets.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            자산
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {assets.map((a) => {
              const slug = assetSlugFromEntity(a);
              return (
                <a
                  key={a.id}
                  href={`/asset/${slug}`}
                  className="rounded-2xl border border-[var(--line)] bg-white p-4 hover:border-[var(--moss)] hover:shadow-sm transition"
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-base font-semibold">{a.label}</span>
                    <span className="text-xs font-mono uppercase text-[var(--muted)]">
                      {slug}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    영상 {a.videoCount}
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* 활성 토픽 */}
      {topics.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            활성 토픽
          </h2>
          <ul className="space-y-2">
            {topics.map((t) => (
              <li key={t.id} className="border-b border-[var(--line)] pb-2">
                <a
                  href={`/topic/${encodeURIComponent(t.id)}`}
                  className="text-sm font-medium hover:text-[var(--moss)]"
                >
                  {t.label}
                </a>
                {t.description && (
                  <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-1">
                    {t.description}
                  </p>
                )}
                <div className="text-[10px] text-[var(--muted)] mt-1 flex gap-2">
                  <span>영상 {t.videoCount}</span>
                  {t.updatedAt && (
                    <>
                      <span>·</span>
                      <FreshnessTime iso={t.updatedAt} compact />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 이벤트 */}
      {events.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            이벤트
          </h2>
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="text-sm">
                <a
                  href={`/event/${encodeURIComponent(e.id)}`}
                  className="hover:text-[var(--moss)]"
                >
                  {e.label}
                </a>{" "}
                <span className="text-xs text-[var(--muted)]">
                  · 영상 {e.videoCount}
                </span>
                {e.updatedAt && (
                  <span className="text-xs ml-1">
                    · <FreshnessTime iso={e.updatedAt} compact />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-16 border-t border-[var(--line)] pt-6 text-xs text-[var(--muted)] flex flex-wrap gap-x-3 gap-y-1">
        <span>by Mossland</span>
        <span>·</span>
        <a href="https://moss.land" className="hover:text-[var(--fg)]">
          moss.land
        </a>
        <span>·</span>
        <a
          href="https://disclosure.moss.land"
          className="hover:text-[var(--fg)]"
        >
          disclosure
        </a>
        <span>·</span>
        <a href="/llms.txt" className="hover:text-[var(--fg)]">llms.txt</a>
        <span>·</span>
        <a href="/rss.xml" className="hover:text-[var(--fg)]">rss</a>
        <span>·</span>
        <a href="/sitemap.xml" className="hover:text-[var(--fg)]">sitemap</a>
        <span className="ml-auto">{new Date().toLocaleString("ko-KR")}</span>
      </footer>
    </main>
  );
}
