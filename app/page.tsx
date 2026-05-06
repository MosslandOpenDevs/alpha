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

export const dynamic = "force-dynamic";
export const revalidate = 60;

const KST_OFFSET_MS = 9 * 3600_000;

function todayKST(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export default function Home() {
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
    <main className="mx-auto w-full max-w-4xl px-6 py-10 sm:py-16">
      <header className="mb-10 flex items-baseline gap-3">
        <span aria-hidden className="font-mono text-2xl text-[--color-moss]">
          α
        </span>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Alpha{" "}
          <span className="text-[--color-muted] font-normal">by Mossland</span>
        </h1>
        <a
          href={`/brief/${todayKST()}`}
          className="ml-auto text-xs text-[--color-moss] hover:underline"
        >
          오늘 브리프 ▸
        </a>
      </header>

      {/* 헤드라인 한 줄 요약 */}
      <section className="mb-10">
        <p className="text-lg leading-relaxed">
          크립토·매크로·국제정세를 한국 유튜브·뉴스 채널 단위로 정리.
          현재 엔티티{" "}
          <span className="font-mono">{totalEntities}</span>개, 토픽{" "}
          <span className="font-mono">{getAllTopics().length}</span>개, 이벤트{" "}
          <span className="font-mono">{getAllEvents().length}</span>개,
          활성 펄스{" "}
          <span className="font-mono">{activePulses.length}</span>건.
        </p>
      </section>

      {/* 활성 Pulse */}
      {activePulses.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[--color-accent] animate-pulse" />
            지금 움직이는 가격 시그널
            <a
              href="/pulse"
              className="ml-auto text-[10px] normal-case font-normal text-[--color-moss] hover:underline tracking-normal"
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
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
            자산
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {assets.map((a) => {
              const slug = assetSlugFromEntity(a);
              return (
                <a
                  key={a.id}
                  href={`/asset/${slug}`}
                  className="rounded-2xl border border-[--color-line] bg-white p-4 hover:border-[--color-moss] hover:shadow-sm transition"
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-base font-semibold">{a.label}</span>
                    <span className="text-xs font-mono uppercase text-[--color-muted]">
                      {slug}
                    </span>
                  </div>
                  <div className="text-xs text-[--color-muted]">
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
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
            활성 토픽
          </h2>
          <ul className="space-y-2">
            {topics.map((t) => (
              <li key={t.id} className="border-b border-[--color-line] pb-2">
                <a
                  href={`/topic/${encodeURIComponent(t.id)}`}
                  className="text-sm font-medium hover:text-[--color-moss]"
                >
                  {t.label}
                </a>
                {t.description && (
                  <p className="text-xs text-[--color-muted] mt-0.5 line-clamp-1">
                    {t.description}
                  </p>
                )}
                <div className="text-[10px] text-[--color-muted] mt-1">
                  영상 {t.videoCount}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 이벤트 */}
      {events.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
            이벤트
          </h2>
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="text-sm">
                <a
                  href={`/event/${encodeURIComponent(e.id)}`}
                  className="hover:text-[--color-moss]"
                >
                  {e.label}
                </a>{" "}
                <span className="text-xs text-[--color-muted]">
                  · 영상 {e.videoCount}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-16 border-t border-[--color-line] pt-6 text-xs text-[--color-muted] flex flex-wrap gap-x-3 gap-y-1">
        <span>by Mossland</span>
        <span>·</span>
        <a href="https://moss.land" className="hover:text-[--color-fg]">
          moss.land
        </a>
        <span>·</span>
        <a
          href="https://disclosure.moss.land"
          className="hover:text-[--color-fg]"
        >
          disclosure
        </a>
        <span>·</span>
        <a href="/llms.txt" className="hover:text-[--color-fg]">llms.txt</a>
        <span>·</span>
        <a href="/rss.xml" className="hover:text-[--color-fg]">rss</a>
        <span>·</span>
        <a href="/sitemap.xml" className="hover:text-[--color-fg]">sitemap</a>
        <span className="ml-auto">{new Date().toLocaleString("ko-KR")}</span>
      </footer>
    </main>
  );
}
