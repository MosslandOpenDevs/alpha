import { notFound } from "next/navigation";
import {
  getChannelFingerprint,
  getVideosByChannel,
} from "@/lib/creators";
import { getEntity, getTopic, stanceDistribution } from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { StanceBar } from "@/components/StanceBar";
import { VideoCard } from "@/components/VideoCard";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 600;

type Props = { params: Promise<{ id: string }> };

const CATEGORY_LABEL: Record<string, string> = {
  economy: "경제",
  tech: "테크",
  news: "뉴스/시사",
  science: "과학",
};

const STANCE_LABEL: Record<string, string> = {
  left: "관점 A",
  right: "관점 B",
  center: "중도/인터뷰",
  observer: "보도",
  "n/a": "—",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const fp = getChannelFingerprint(id);
  if (!fp) return { title: `Channel ${id} — Alpha`, robots: { index: false } };
  const title = `${fp.channel.name} — 채널 fingerprint`;
  const desc = `${fp.channel.name} (${CATEGORY_LABEL[fp.channel.category] || fp.channel.category}) 분석 영상 ${fp.videoCount}편 + 주요 entity/topic 분포.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `${SITE.baseUrl}/creator/${id}` },
    openGraph: { title, description: desc, type: "profile" },
  };
}

export default async function CreatorPage({ params }: Props) {
  const { id } = await params;
  const fp = getChannelFingerprint(id);
  if (!fp) notFound();

  const videos = getVideosByChannel(id, 12);
  const dist = stanceDistribution(videos);
  const quality = Math.min(1, fp.videoCount / 5);

  registerSeoPage({
    path: `/creator/${id}`,
    page_type: "creator",
    canonical_id: id,
    title: `${fp.channel.name} — 채널 fingerprint`,
    meta_description: `${fp.channel.name}: 분석 ${fp.videoCount}편, 주요 entity ${fp.topEntityIds.length}개.`,
    quality_score: quality,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Creators", href: "/" },
    { name: fp.channel.name, href: `/creator/${id}` },
  ]);

  const personLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: fp.channel.name,
    url: `${SITE.baseUrl}/creator/${id}`,
    sameAs: [
      `https://www.youtube.com/channel/${id}`,
    ],
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(personLd) }}
      />

      <nav className="text-xs text-[--color-muted] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Creator</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          {fp.channel.name}
        </h1>
        <div className="flex flex-wrap gap-2 text-xs text-[--color-muted]">
          <span className="rounded-full border border-[--color-line] px-2 py-0.5">
            {CATEGORY_LABEL[fp.channel.category] || fp.channel.category}
          </span>
          <span className="rounded-full border border-[--color-line] px-2 py-0.5">
            {STANCE_LABEL[fp.channel.stance] || fp.channel.stance}
          </span>
          <span className="rounded-full border border-[--color-line] px-2 py-0.5">
            {fp.channel.language?.toUpperCase()}
          </span>
          <a
            className="rounded-full border border-[--color-line] px-2 py-0.5 hover:border-[--color-moss]"
            href={`https://www.youtube.com/channel/${id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            YouTube ▸
          </a>
        </div>
        {fp.channel.notes && (
          <p className="mt-3 text-sm text-zinc-700 leading-relaxed">
            {fp.channel.notes}
          </p>
        )}
      </header>

      <section className="mb-6">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-2">
          한 줄 요약
        </h2>
        <p className="text-base">
          이 채널은 분석된 영상 {fp.videoCount}편에서 stance가 {dist.agree}/
          {dist.disagree}/{dist.observe}로 분포. 갈림 점수 {dist.divergenceScore}.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
          입장 분포
        </h2>
        <StanceBar dist={dist} />
      </section>

      {fp.topEntityIds.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
            자주 다루는 엔티티 ({fp.topEntityIds.length})
          </h2>
          <ul className="grid grid-cols-2 gap-2">
            {fp.topEntityIds.map(({ id: eid, count }) => {
              const e = getEntity(eid);
              if (!e) return null;
              const href =
                e.type === "asset"
                  ? `/asset/${e.id}`
                  : `/entity/${encodeURIComponent(e.id)}`;
              return (
                <li key={eid}>
                  <a
                    href={href}
                    className="block rounded-lg border border-[--color-line] bg-white px-3 py-2 hover:border-[--color-moss]"
                  >
                    <div className="text-sm font-medium">{e.label}</div>
                    <div className="text-xs text-[--color-muted]">
                      {count}회 · {e.type}
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {fp.topTopicIds.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
            자주 다루는 토픽
          </h2>
          <ul className="space-y-1.5">
            {fp.topTopicIds.map(({ id: tid, count }) => {
              const t = getTopic(tid);
              if (!t) return null;
              return (
                <li key={tid} className="text-sm">
                  <a
                    href={`/topic/${encodeURIComponent(t.id)}`}
                    className="text-[--color-moss] hover:underline"
                  >
                    {t.label}
                  </a>{" "}
                  <span className="text-xs text-[--color-muted]">{count}회</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
          최근 영상 ({videos.length})
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <VideoCard key={v.source.videoId} video={v} />
          ))}
        </div>
      </section>

      <footer className="mt-12 border-t border-[--color-line] pt-4 text-xs text-[--color-muted]">
        <span>출처: signalmap canonical (Mossland)</span>
      </footer>
    </main>
  );
}
