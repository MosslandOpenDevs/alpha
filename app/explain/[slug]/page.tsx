import { notFound } from "next/navigation";
import { getExplainer } from "@/lib/explainers";
import { getEntity, getTopic } from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE, pageOpenGraph } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import type { Metadata } from "next";

export const dynamic = "force-static";
export const revalidate = 86400;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ex = getExplainer(slug);
  if (!ex) return { title: `Explain ${slug}`, robots: { index: false } };
  return {
    title: ex.title,
    description: ex.oneLine.slice(0, 200),
    alternates: { canonical: `${SITE.baseUrl}/explain/${slug}` },
    openGraph: pageOpenGraph({
      title: ex.title,
      description: ex.oneLine.slice(0, 200),
      path: `/explain/${slug}`,
    }),
  };
}

export default async function ExplainPage({ params }: Props) {
  const { slug } = await params;
  const ex = getExplainer(slug);
  if (!ex) notFound();

  registerSeoPage({
    path: `/explain/${slug}`,
    page_type: "topic",
    canonical_id: slug,
    title: ex.title,
    meta_description: ex.oneLine.slice(0, 200),
    quality_score: 0.9, // curated content는 항상 high quality
    lastmod: ex.updatedAt + "T00:00:00Z",
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "설명", href: "/" },
    { name: ex.title, href: `/explain/${slug}` },
  ]);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: ex.title,
    alternativeHeadline: ex.titleEn,
    datePublished: ex.updatedAt + "T00:00:00Z",
    dateModified: ex.updatedAt + "T00:00:00Z",
    author: { "@type": "Organization", name: "Mossland" },
    publisher: { "@type": "Organization", name: "Mossland" },
    description: ex.oneLine,
    inLanguage: "ko-KR",
    url: `${SITE.baseUrl}/explain/${slug}`,
  };

  const faqLd = ex.faq && ex.faq.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: ex.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }
    : null;

  const relatedEntities = (ex.relatedEntityIds || [])
    .map((id) => getEntity(id))
    .filter((e): e is NonNullable<typeof e> => !!e);

  const relatedTopics = (ex.relatedTopicIds || [])
    .map((id) => getTopic(id))
    .filter((t): t is NonNullable<typeof t> => !!t);

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
        <span>Explain</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
          {ex.title}
        </h1>
        {ex.titleEn && (
          <p className="text-sm text-[var(--muted)] italic mb-3">{ex.titleEn}</p>
        )}
      </header>

      {/* 답변 가능 5-블록 */}

      {/* [1] 한 줄 요약 */}
      <section className="mb-8 rounded-2xl border border-[var(--moss)] bg-green-50/30 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--moss)] mb-2">
          한 줄 요약
        </h2>
        <p className="text-base leading-relaxed">{ex.oneLine}</p>
        {ex.oneLineEn && (
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 italic">
            {ex.oneLineEn}
          </p>
        )}
      </section>

      {/* [2] 왜 중요 */}
      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          왜 중요한가
        </h2>
        <p className="text-base leading-relaxed">{ex.whyImportant}</p>
      </section>

      {/* [3] 핵심 포인트 5개 */}
      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          핵심 포인트
        </h2>
        <ol className="space-y-2 list-decimal list-inside leading-relaxed">
          {ex.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      </section>

      {/* [4] FAQ */}
      {ex.faq && ex.faq.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            자주 묻는 질문
          </h2>
          <dl className="space-y-4">
            {ex.faq.map((f, i) => (
              <div key={i} className="rounded-2xl border border-[var(--line)] bg-white p-4">
                <dt className="text-sm font-semibold mb-1.5">{f.q}</dt>
                <dd className="text-sm text-zinc-700 leading-relaxed">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* 관련 (internal linking) */}
      {(relatedEntities.length > 0 || relatedTopics.length > 0) && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            관련 페이지
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
                {e.label}
              </a>
            ))}
            {relatedTopics.map((t) => (
              <a
                key={t.id}
                href={`/topic/${encodeURIComponent(t.id)}`}
                className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs hover:border-[var(--moss)]"
              >
                {t.label}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* 출처 */}
      {ex.sources && ex.sources.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            출처
          </h2>
          <ul className="space-y-1 text-sm">
            {ex.sources.map((s, i) => (
              <li key={i}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--moss)] hover:underline"
                >
                  {s.title} ▸
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* [5] 마지막 업데이트 */}
      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>마지막 업데이트: {ex.updatedAt}</span>
        <span className="mx-2">·</span>
        <span>유형: 큐레이션된 explainer</span>
      </footer>
    </main>
  );
}
