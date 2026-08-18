import { notFound } from "next/navigation";
import {
  getEvent,
  getVideosForEvent,
  stanceDistribution,
  getEntity,
} from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE, pageOpenGraph } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { StanceBar } from "@/components/StanceBar";
import { VideoCard } from "@/components/VideoCard";
import { SynthesisCard } from "@/components/SynthesisCard";
import { FreshnessTime } from "@/components/FreshnessTime";
import { getSynthesis } from "@/lib/synthesis";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ev = getEvent(slug);
  if (!ev) {
    return { title: `Event ${slug} — Alpha`, robots: { index: false } };
  }
  const title = `${ev.label} — 사건 정리 + 채널 시각`;
  const desc = `${ev.label}에 대해 한국 채널 ${ev.videoCount}편이 어떻게 다뤘는지 정리.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `${SITE.baseUrl}/event/${slug}` },
    openGraph: pageOpenGraph({ title, description: desc, path: `/event/${slug}` }),
  };
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const ev = getEvent(slug);
  if (!ev) notFound();

  const videos = getVideosForEvent(ev.id, 20);
  const dist = stanceDistribution(videos);
  const quality = Math.min(1, ev.videoCount / 8);

  registerSeoPage({
    path: `/event/${slug}`,
    page_type: "event",
    canonical_id: ev.id,
    title: `${ev.label} — 사건 정리 + 채널 시각`,
    meta_description: `${ev.label}에 대한 한국 채널 ${ev.videoCount}편의 시각 정리.`,
    quality_score: quality,
    lastmod: ev.updatedAt,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Events", href: "/" },
    { name: ev.label, href: `/event/${slug}` },
  ]);

  const newsEventLd = {
    "@context": "https://schema.org",
    "@type": "NewsEvent",
    name: ev.label,
    alternateName: ev.aliases,
    startDate: ev.dateHint || ev.createdAt,
    description: `${ev.label}에 대한 한국 유튜브·뉴스 채널 시각 정리.`,
    url: `${SITE.baseUrl}/event/${slug}`,
  };

  // related entities
  const relatedEntities = (ev.relatedEntityIds || [])
    .map((id) => getEntity(id))
    .filter((e): e is NonNullable<typeof e> => !!e);

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(newsEventLd) }}
      />

      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Event</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          {ev.label}
        </h1>
        {ev.dateHint && (
          <div className="text-sm text-[var(--muted)] font-mono">
            {ev.dateHint}
          </div>
        )}
      </header>

      {(() => {
        const synthesis = getSynthesis("event", ev.id);
        return synthesis ? (
          <SynthesisCard synthesis={synthesis} refLabel={ev.label} />
        ) : null;
      })()}

      <section className="mb-6">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
          한 줄 요약 (데이터)
        </h2>
        <p className="text-base">
          {videos.length}편의 한국 채널이 이 사건을 다뤘고, 의견은 {dist.agree}/
          {dist.disagree}/{dist.observe} 분포. 갈림 {dist.divergenceScore}.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          입장 분포
        </h2>
        <StanceBar dist={dist} />
      </section>

      {relatedEntities.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            연결된 엔티티
          </h2>
          <div className="flex flex-wrap gap-2">
            {relatedEntities.map((e) => (
              <a
                key={e.id}
                href={
                  e.type === "asset"
                    ? `/asset/${e.id}`
                    : `/entity/${encodeURIComponent(e.id)}`
                }
                className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs hover:border-[var(--moss)]"
              >
                {e.label}{" "}
                <span className="text-[var(--muted)]">({e.type})</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          관련 영상 ({videos.length})
        </h2>
        {videos.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">아직 분석된 영상 없음.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {videos.slice(0, 12).map((v) => (
              <VideoCard key={v.source.videoId} video={v} />
            ))}
          </div>
        )}
      </section>

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>
          마지막 업데이트: <FreshnessTime iso={ev.updatedAt} />
        </span>
        <span className="mx-2">·</span>
        <span>출처: signalmap canonical (Mossland)</span>
      </footer>
    </main>
  );
}
