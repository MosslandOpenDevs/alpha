import { notFound } from "next/navigation";
import { getComparison } from "@/lib/comparisons";
import { getEntity, getTopic } from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import type { Metadata } from "next";

export const dynamic = "force-static";
export const revalidate = 86400;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = getComparison(slug);
  if (!c) return { title: `Compare ${slug}`, robots: { index: false } };
  return {
    title: c.title,
    description: c.oneLineSummary.slice(0, 200),
    alternates: { canonical: `${SITE.baseUrl}/compare/${slug}` },
    openGraph: { title: c.title, description: c.oneLineSummary, type: "article" },
  };
}

function resolveSideHref(s: { refType?: string; refId?: string }): string | null {
  if (!s.refId) return null;
  if (s.refType === "entity") {
    const e = getEntity(s.refId);
    if (!e) return null;
    return e.type === "asset"
      ? `/asset/${e.id}`
      : `/entity/${encodeURIComponent(e.id)}`;
  }
  if (s.refType === "topic") {
    const t = getTopic(s.refId);
    if (!t) return null;
    return `/topic/${encodeURIComponent(t.id)}`;
  }
  return null;
}

export default async function ComparePage({ params }: Props) {
  const { slug } = await params;
  const c = getComparison(slug);
  if (!c) notFound();

  registerSeoPage({
    path: `/compare/${slug}`,
    page_type: "compare",
    canonical_id: slug,
    title: c.title,
    meta_description: c.oneLineSummary.slice(0, 200),
    quality_score: 0.85,
    lastmod: c.updatedAt + "T00:00:00Z",
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "비교", href: "/compare" },
    { name: c.title, href: `/compare/${slug}` },
  ]);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: c.title,
    alternativeHeadline: c.titleEn,
    datePublished: c.updatedAt + "T00:00:00Z",
    dateModified: c.updatedAt + "T00:00:00Z",
    author: { "@type": "Organization", name: "Mossland" },
    publisher: { "@type": "Organization", name: "Mossland" },
    description: c.oneLineSummary,
    inLanguage: "ko-KR",
    url: `${SITE.baseUrl}/compare/${slug}`,
  };

  const faqLd = c.faq && c.faq.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: c.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }
    : null;

  const aHref = resolveSideHref(c.sideA);
  const bHref = resolveSideHref(c.sideB);

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
      {faqLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(faqLd) }}
        />
      )}

      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <a href="/compare" className="hover:underline">Compare</a>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
          {c.title}
        </h1>
        {c.titleEn && (
          <p className="text-sm text-[var(--muted)] italic">{c.titleEn}</p>
        )}
      </header>

      {/* 한 줄 요약 */}
      <section className="mb-8 rounded-2xl border border-[var(--moss)] bg-green-50/30 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--moss)] mb-2">
          한 줄 요약
        </h2>
        <p className="text-base leading-relaxed">{c.oneLineSummary}</p>
      </section>

      {/* 양 측 비교 */}
      <section className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h3 className="text-base font-semibold mb-2">
            {aHref ? (
              <a
                href={aHref}
                className="hover:text-[var(--moss)] hover:underline"
              >
                {c.sideA.label}
              </a>
            ) : (
              c.sideA.label
            )}
          </h3>
          <p className="text-sm text-zinc-700 leading-relaxed mb-3">
            {c.sideA.oneLine}
          </p>
          <ul className="space-y-1.5 text-sm list-disc list-inside text-zinc-700">
            {c.sideA.points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h3 className="text-base font-semibold mb-2">
            {bHref ? (
              <a
                href={bHref}
                className="hover:text-[var(--moss)] hover:underline"
              >
                {c.sideB.label}
              </a>
            ) : (
              c.sideB.label
            )}
          </h3>
          <p className="text-sm text-zinc-700 leading-relaxed mb-3">
            {c.sideB.oneLine}
          </p>
          <ul className="space-y-1.5 text-sm list-disc list-inside text-zinc-700">
            {c.sideB.points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </article>
      </section>

      {/* Alpha 종합 */}
      <section className="mb-8 rounded-2xl bg-zinc-900 text-white p-5">
        <h3 className="text-xs uppercase tracking-wider text-[var(--accent)] mb-2">
          Alpha의 종합 시각
        </h3>
        <p className="text-base leading-relaxed">{c.alphaTake}</p>
      </section>

      {/* FAQ */}
      {c.faq && c.faq.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            자주 묻는 질문
          </h2>
          <dl className="space-y-3">
            {c.faq.map((f, i) => (
              <div
                key={i}
                className="rounded-2xl border border-[var(--line)] bg-white p-4"
              >
                <dt className="text-sm font-semibold mb-1.5">{f.q}</dt>
                <dd className="text-sm text-zinc-700 leading-relaxed">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>마지막 업데이트: {c.updatedAt}</span>
        <span className="mx-2">·</span>
        <span>유형: 큐레이션된 비교</span>
      </footer>
    </main>
  );
}
