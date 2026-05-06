import { notFound, redirect } from "next/navigation";
import {
  getEntity,
  getVideosForEntity,
  stanceDistribution,
} from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { StanceBar } from "@/components/StanceBar";
import { VideoCard } from "@/components/VideoCard";
import { CoMentionedChips } from "@/components/CoMentionedChips";
import { SynthesisCard } from "@/components/SynthesisCard";
import { getSynthesis } from "@/lib/synthesis";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

const TYPE_LABEL: Record<string, string> = {
  person: "인물",
  org: "기관",
  country: "국가",
  concept: "개념",
  asset: "자산",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const entity = getEntity(decoded);
  if (!entity) return { title: `${decoded} — Alpha`, robots: { index: false } };
  const title = `${entity.label} — 한국 채널 시각`;
  const desc = `${entity.label} (${TYPE_LABEL[entity.type] || entity.type})에 대한 한국 채널 ${entity.videoCount}편 정리.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `${SITE.baseUrl}/entity/${slug}` },
    openGraph: { title, description: desc, type: "article" },
  };
}

export default async function EntityPage({ params }: Props) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const entity = getEntity(decoded);
  if (!entity) notFound();

  // /asset/* 로 redirect — 자산은 별도 라우트 (가격 widget 등)
  if (entity.type === "asset") {
    redirect(`/asset/${entity.id}`);
  }

  const videos = getVideosForEntity(entity.id, 20);
  const dist = stanceDistribution(videos);
  const quality = Math.min(1, entity.videoCount / 10);

  registerSeoPage({
    path: `/entity/${slug}`,
    page_type: "entity",
    canonical_id: entity.id,
    title: `${entity.label} — 한국 채널 시각`,
    meta_description: `${entity.label} (${TYPE_LABEL[entity.type]})에 대한 채널 ${entity.videoCount}편 시각.`,
    quality_score: quality,
    lastmod: entity.updatedAt,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Entity", href: "/" },
    { name: entity.label, href: `/entity/${slug}` },
  ]);

  const schemaType =
    entity.type === "person" ? "Person" :
    entity.type === "org" ? "Organization" :
    entity.type === "country" ? "Country" :
    "Thing";

  const entityLd = {
    "@context": "https://schema.org",
    "@type": schemaType,
    name: entity.label,
    alternateName: entity.aliases,
    url: `${SITE.baseUrl}/entity/${slug}`,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(entityLd) }}
      />

      <nav className="text-xs text-[--color-muted] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>{TYPE_LABEL[entity.type] || "Entity"}</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          {entity.label}
        </h1>
        <div className="text-xs text-[--color-muted]">
          {TYPE_LABEL[entity.type] || entity.type}
          {entity.aliases.length > 0 && (
            <span> · {entity.aliases.join(", ")}</span>
          )}
        </div>
      </header>

      {(() => {
        const synthesis = getSynthesis("entity", entity.id);
        return synthesis ? (
          <SynthesisCard synthesis={synthesis} refLabel={entity.label} />
        ) : null;
      })()}

      <section className="mb-6">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-2">
          한 줄 요약 (데이터)
        </h2>
        <p className="text-base">
          {entity.label}을(를) 다룬 영상 {videos.length}편. 의견 {dist.agree}/
          {dist.disagree}/{dist.observe}. 갈림 {dist.divergenceScore}.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
          입장 분포
        </h2>
        <StanceBar dist={dist} />
      </section>

      <CoMentionedChips focalEntityId={entity.id} />

      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
          관련 영상 ({videos.length})
        </h2>
        {videos.length === 0 ? (
          <p className="text-sm text-[--color-muted]">아직 분석된 영상 없음.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {videos.slice(0, 12).map((v) => (
              <VideoCard key={v.source.videoId} video={v} />
            ))}
          </div>
        )}
      </section>

      <footer className="mt-12 border-t border-[--color-line] pt-4 text-xs text-[--color-muted]">
        <span>마지막 업데이트: {new Date(entity.updatedAt).toLocaleString("ko-KR")}</span>
        <span className="mx-2">·</span>
        <span>출처: signalmap canonical (Mossland)</span>
      </footer>
    </main>
  );
}
