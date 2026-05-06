import { notFound } from "next/navigation";
import {
  getAssetOrStub,
  getVideosForEntity,
  stanceDistribution,
  getActivePulses,
} from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { StanceBar } from "@/components/StanceBar";
import { VideoCard } from "@/components/VideoCard";
import { PulseCard } from "@/components/PulseCard";
import { CoMentionedChips } from "@/components/CoMentionedChips";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 300;

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const entity = getAssetOrStub(symbol);
  if (!entity) {
    return { title: `${symbol.toUpperCase()} — Alpha`, robots: { index: false } };
  }
  const title = `${entity.label} (${symbol.toUpperCase()}) — 한국 채널 시각 정리`;
  const desc = entity.videoCount > 0
    ? `${entity.label}에 대한 한국 유튜브·뉴스 채널의 stance 분포, 최근 영상 ${entity.videoCount}편 정리.`
    : `${entity.label}에 대한 한국 채널 분석. 데이터 누적 중.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `${SITE.baseUrl}/asset/${symbol.toLowerCase()}` },
    openGraph: { title, description: desc, type: "article" },
    robots: entity.videoCount === 0 ? { index: false } : { index: true },
  };
}

export default async function AssetPage({ params }: Props) {
  const { symbol } = await params;
  const entity = getAssetOrStub(symbol);
  if (!entity) {
    notFound();
  }

  const videos = getVideosForEntity(entity.id, 20);
  const dist = stanceDistribution(videos);
  const pulses = getActivePulses(72).filter(
    (p) => p.asset.toLowerCase() === symbol.toLowerCase()
  );

  // Quality score: ≥5 videos = full quality. <5 = sparse → noindex.
  const quality = Math.min(1, entity.videoCount / 20);

  registerSeoPage({
    path: `/asset/${symbol.toLowerCase()}`,
    page_type: "asset",
    canonical_id: entity.id,
    title: `${entity.label} (${symbol.toUpperCase()}) — 한국 채널 시각 정리`,
    meta_description: `${entity.label}: 채널별 stance + 최근 ${entity.videoCount} 영상 + 활성 pulse ${pulses.length}.`,
    quality_score: quality,
    lastmod: entity.updatedAt,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Assets", href: "/" },
    { name: entity.label, href: `/asset/${symbol.toLowerCase()}` },
  ]);

  // FinancialProduct schema for asset
  const financialProductLd = {
    "@context": "https://schema.org",
    "@type": "Thing",
    name: entity.label,
    alternateName: [...entity.aliases, symbol.toUpperCase()],
    description: `${entity.label} (${symbol.toUpperCase()}) — Alpha의 채널별 stance 분석.`,
    url: `${SITE.baseUrl}/asset/${symbol.toLowerCase()}`,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(financialProductLd) }}
      />

      <nav className="text-xs text-[--color-muted] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Asset</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          {entity.label}{" "}
          <span className="text-[--color-muted] font-mono text-2xl">
            {symbol.toUpperCase()}
          </span>
        </h1>
        <p className="text-sm text-[--color-muted]">
          한국 유튜브·뉴스 채널이 {entity.label}에 대해 어떻게 보고 있는지
          정리. 최근 분석된 영상 {videos.length}편.
        </p>
      </header>

      {/* 답변 가능 5-블록 */}

      {/* [1] 한 줄 요약 */}
      <section className="mb-6">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-2">
          한 줄 요약
        </h2>
        <p className="text-base text-[--color-fg]">
          최근 {videos.length}편 영상 중 {dist.agree}개 강세, {dist.disagree}개
          약세, {dist.observe}개 관찰. 갈림 점수 {dist.divergenceScore}.
        </p>
      </section>

      {/* [2] stance 분포 */}
      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
          채널 입장 분포
        </h2>
        <StanceBar dist={dist} />
      </section>

      {/* [3a] 함께 언급되는 것들 (internal linking density) */}
      {entity.videoCount > 0 && (
        <CoMentionedChips focalEntityId={entity.id} />
      )}

      {/* [3] 활성 pulse */}
      {pulses.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
            최근 가격 시그널
          </h2>
          <div className="space-y-3">
            {pulses.slice(0, 3).map((p) => (
              <PulseCard key={p.id} pulse={p} compact />
            ))}
          </div>
        </section>
      )}

      {/* [4] 최근 영상 카드 */}
      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
          최근 영상 분석
        </h2>
        {videos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[--color-line] bg-zinc-50 p-5 text-sm text-[--color-muted]">
            <p>
              아직 signalmap canonical에 누적된 분석 영상이 없습니다.
              {entity.aliases.length > 0 && (
                <>
                  {" "}
                  ({entity.aliases.join(", ")} 별칭 포함)
                </>
              )}
            </p>
            <p className="mt-2 text-xs">
              데이터가 쌓이면 자동으로 업데이트됩니다. 그동안 관련 키워드는{" "}
              <a href="/pulse" className="text-[--color-moss] hover:underline">
                Pulse
              </a>{" "}
              또는{" "}
              <a href="/" className="text-[--color-moss] hover:underline">
                홈
              </a>
              에서 인접 토픽을 확인하세요.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {videos.slice(0, 8).map((v) => (
              <VideoCard key={v.source.videoId} video={v} />
            ))}
          </div>
        )}
      </section>

      {/* [5] 마지막 업데이트 */}
      <footer className="mt-12 border-t border-[--color-line] pt-4 text-xs text-[--color-muted]">
        <span>마지막 업데이트: {new Date(entity.updatedAt).toLocaleString("ko-KR")}</span>
        <span className="mx-2">·</span>
        <span>출처: signalmap canonical (Mossland)</span>
        <span className="mx-2">·</span>
        <span>인용 정책: 원본 직링크는 카드 안 quote에 표기</span>
      </footer>
    </main>
  );
}
