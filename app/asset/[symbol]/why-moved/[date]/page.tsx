import { notFound, permanentRedirect } from "next/navigation";
import { getWhyMoved } from "@/lib/why-moved";
import { assetSlugFromEntity, getAssetOrStub } from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { deleteSeoPage } from "@/lib/db";
import { SITE, pageOpenGraph } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { PulseCard } from "@/components/PulseCard";
import type { Metadata } from "next";
import { fmtKst } from "@/lib/health";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

type Props = { params: Promise<{ symbol: string; date: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol, date } = await params;
  if (!DATE_RE.test(date)) {
    return { title: `${symbol} ${date}`, robots: { index: false } };
  }
  const entity = getAssetOrStub(symbol);
  const canonicalSymbol = entity
    ? assetSlugFromEntity(entity)
    : symbol.toLowerCase();
  const article = getWhyMoved(canonicalSymbol, date);
  if (!article) {
    return {
      title: `${symbol.toUpperCase()} ${date} — 데이터 없음`,
      robots: { index: false },
    };
  }
  return {
    title: article.title,
    description: article.oneLine.slice(0, 200),
    alternates: {
      canonical: `${SITE.baseUrl}/asset/${canonicalSymbol}/why-moved/${date}`,
    },
    openGraph: pageOpenGraph({
      title: article.title,
      description: article.oneLine,
      path: `/asset/${symbol}/why-moved/${date}`,
    }),
  };
}

export default async function WhyMovedPage({ params }: Props) {
  const { symbol, date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const entity = getAssetOrStub(symbol);
  const canonicalSymbol = entity
    ? assetSlugFromEntity(entity)
    : symbol.toLowerCase();
  // Pulses exist for instruments that have no asset page (BTC-KRW, USDKRW —
  // roughly a third of active pulses). Their why-moved articles are real, but
  // /asset/<slug> for them is a 404, so every parent link on this page —
  // nav, footer, breadcrumb JSON-LD — pointed at one. Send those to /pulse.
  const parentHref = entity ? `/asset/${canonicalSymbol}` : "/pulse";
  if (symbol.toLowerCase() !== canonicalSymbol) {
    deleteSeoPage(`/asset/${symbol.toLowerCase()}/why-moved/${date}`);
    permanentRedirect(`/asset/${canonicalSymbol}/why-moved/${date}`);
  }

  const article = getWhyMoved(canonicalSymbol, date);
  if (!article) {
    // 페이지는 살아있으나 데이터 없음 → noindex
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
        <nav className="text-xs text-[var(--muted)] mb-4">
          <a href="/" className="hover:underline">α Alpha</a>
          <span className="mx-2">/</span>
          <a href={parentHref} className="hover:underline">
            {symbol.toUpperCase()}
          </a>
          <span className="mx-2">/</span>
          <span>Why moved · {date}</span>
        </nav>
        <header className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
            {symbol.toUpperCase()} — {date} 데이터 없음
          </h1>
          <p className="text-sm text-[var(--muted)]">
            이 날에 추적된 가격 시그널이 없습니다. signalmap이 매 5분 윈도우 1%
            이상 변동만 감지합니다.
          </p>
          <p className="mt-3">
            <a href={parentHref} className="text-[var(--moss)] hover:underline">
              ← {entity ? `${symbol.toUpperCase()} 페이지로` : "Pulse 목록으로"}
            </a>
          </p>
        </header>
      </main>
    );
  }

  const assetLabel = entity?.label || symbol.toUpperCase();

  registerSeoPage({
    path: `/asset/${canonicalSymbol}/why-moved/${date}`,
    page_type: "event",
    canonical_id: `${canonicalSymbol}-${date}`,
    title: article.title,
    meta_description: article.oneLine.slice(0, 200),
    quality_score: 0.85,
    lastmod: article.generatedAt,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: assetLabel, href: parentHref },
    { name: `Why moved ${date}`, href: `/asset/${canonicalSymbol}/why-moved/${date}` },
  ]);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    datePublished: date + "T00:00:00+09:00",
    dateModified: article.generatedAt,
    author: { "@type": "Organization", name: "Alpha by Mossland" },
    publisher: { "@type": "Organization", name: "Mossland" },
    description: article.oneLine,
    inLanguage: "ko-KR",
    url: `${SITE.baseUrl}/asset/${canonicalSymbol}/why-moved/${date}`,
    about: {
      "@type": "Thing",
      name: assetLabel,
    },
  };

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(articleLd) }}
      />

      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <a href={parentHref} className="hover:underline">
          {assetLabel}
        </a>
        <span className="mx-2">/</span>
        <span className="font-mono">{date}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-snug">
          {article.title}
        </h1>
      </header>

      {/* 한 줄 요약 */}
      <section className="mb-8 rounded-2xl border border-[var(--moss)] bg-green-50/30 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--moss)] mb-2">
          한 줄 결론
        </h2>
        <p className="text-base leading-relaxed">{article.oneLine}</p>
      </section>

      {article.why && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            왜 중요한가
          </h2>
          <p className="text-base leading-relaxed">{article.why}</p>
        </section>
      )}

      {/* 5 포인트 */}
      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          핵심 포인트
        </h2>
        <ol className="space-y-2 list-decimal list-inside leading-relaxed">
          {article.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      </section>

      {/* 그날의 pulse */}
      {article.pulses.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            가격 시그널 ({article.pulses.length})
          </h2>
          <div className="space-y-3">
            {article.pulses.map((p) => (
              <PulseCard key={p.id} pulse={p} compact />
            ))}
          </div>
        </section>
      )}

      {/* 출처 */}
      {article.sources.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            출처 ({article.sources.length})
          </h2>
          <ul className="space-y-2">
            {article.sources.map((s, i) => (
              <li key={i} className="text-sm">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--moss)] hover:underline"
                >
                  {s.title || s.url}
                </a>
                {s.publisher && (
                  <span className="text-[var(--muted)]"> — {s.publisher}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>마지막 갱신: {fmtKst(article.generatedAt)}</span>
        <span className="mx-2">·</span>
        <span>Alpha 합성 — pulse + sources 기반</span>
        <span className="mx-2">·</span>
        <a href={parentHref} className="text-[var(--moss)] hover:underline">
          ← {entity ? `${assetLabel} 페이지로` : "Pulse 목록으로"}
        </a>
      </footer>
    </main>
  );
}
