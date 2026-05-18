import { notFound } from "next/navigation";
import {
  getTopic,
  getVideosForTopic,
  stanceDistribution,
} from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
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
  const topic = getTopic(slug);
  if (!topic) {
    return { title: `Topic ${slug} — Alpha`, robots: { index: false } };
  }
  const title = `${topic.label} — 한국 채널은 어떻게 보고 있나?`;
  const desc =
    topic.description ||
    `${topic.label}에 대한 한국 유튜브·뉴스 채널 시각 정리, ${topic.videoCount}편.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `${SITE.baseUrl}/topic/${slug}` },
    openGraph: { title, description: desc, type: "article" },
  };
}

export default async function TopicPage({ params }: Props) {
  const { slug } = await params;
  const topic = getTopic(slug);
  if (!topic) notFound();

  const videos = getVideosForTopic(topic.id, 20);
  const dist = stanceDistribution(videos);
  const quality = Math.min(1, topic.videoCount / 10);

  registerSeoPage({
    path: `/topic/${slug}`,
    page_type: "topic",
    canonical_id: topic.id,
    title: `${topic.label} — 한국 채널은 어떻게 보고 있나?`,
    meta_description: topic.description || null,
    quality_score: quality,
    lastmod: topic.updatedAt,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Topics", href: "/" },
    { name: topic.label, href: `/topic/${slug}` },
  ]);

  const definedTermLd = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: topic.label,
    alternateName: topic.aliases,
    description: topic.description,
    url: `${SITE.baseUrl}/topic/${slug}`,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(definedTermLd) }}
      />

      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Topic</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
          {topic.label}
        </h1>
        {topic.description && (
          <p className="text-base leading-relaxed text-zinc-700">
            {topic.description}
          </p>
        )}
      </header>

      {(() => {
        const synthesis = getSynthesis("topic", topic.id);
        return synthesis ? (
          <SynthesisCard synthesis={synthesis} refLabel={topic.label} />
        ) : null;
      })()}

      <section className="mb-6">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
          한 줄 요약 (데이터)
        </h2>
        <p className="text-base">
          {videos.length}편 영상에서 의견은 {dist.agree}/{dist.disagree}/{dist.observe}로
          분포. 갈림 점수 {dist.divergenceScore}.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          입장 분포
        </h2>
        <StanceBar dist={dist} />
      </section>

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
          마지막 업데이트: <FreshnessTime iso={topic.updatedAt} />
        </span>
        <span className="mx-2">·</span>
        <span>출처: signalmap canonical (Mossland)</span>
      </footer>
    </main>
  );
}
