import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import type { Citation } from "@/lib/ask";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 86400;

type Props = { params: Promise<{ hash: string }> };

type AnswerRow = {
  hash: string;
  question: string;
  answer: string;
  citations: string;
  generated_at: string;
};

function getAnswer(hash: string): {
  question: string;
  answer: string;
  citations: Citation[];
  generatedAt: string;
} | null {
  const row = getDb()
    .prepare(`SELECT * FROM alpha_questions WHERE hash = ?`)
    .get(hash) as AnswerRow | undefined;
  if (!row) return null;
  return {
    question: row.question,
    answer: row.answer,
    citations: JSON.parse(row.citations) as Citation[],
    generatedAt: row.generated_at,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { hash } = await params;
  const a = getAnswer(hash);
  if (!a) {
    return { title: `질문 ${hash}`, robots: { index: false } };
  }
  const title = a.question.length > 60 ? a.question.slice(0, 57) + "..." : a.question;
  return {
    title: `${title} — Ask Alpha`,
    description: a.answer.slice(0, 200),
    alternates: { canonical: `${SITE.baseUrl}/ask/q/${hash}` },
    openGraph: { title, description: a.answer.slice(0, 200), type: "article" },
  };
}

export default async function QPage({ params }: Props) {
  const { hash } = await params;
  const a = getAnswer(hash);
  if (!a) notFound();

  // 답변 길이 ≥ 100 AND citations ≥ 2 면 index, 아니면 noindex
  const indexable = a.answer.length >= 100 && a.citations.length >= 2;

  registerSeoPage({
    path: `/ask/q/${hash}`,
    page_type: "agent",
    canonical_id: hash,
    title: a.question,
    meta_description: a.answer.slice(0, 200),
    index_policy: indexable ? "index" : "noindex",
    quality_score: indexable ? 0.7 : 0.2,
    lastmod: a.generatedAt,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Ask", href: "/ask" },
    { name: a.question.slice(0, 30), href: `/ask/q/${hash}` },
  ]);

  // QAPage schema (Google은 1 question per page를 권장)
  // Required: answerCount on Question, text on Question, author on Question,
  //           url on Answer, upvoteCount on Answer, url on Answer.author
  const qaUrl = `${SITE.baseUrl}/ask/q/${hash}`;
  const qaLd = {
    "@context": "https://schema.org",
    "@type": "QAPage",
    mainEntity: {
      "@type": "Question",
      name: a.question,
      text: a.question,
      answerCount: 1,
      upvoteCount: 0,
      dateCreated: a.generatedAt,
      author: {
        "@type": "Organization",
        name: "Alpha by Mossland",
        url: SITE.baseUrl,
      },
      acceptedAnswer: {
        "@type": "Answer",
        text: a.answer,
        url: qaUrl,
        upvoteCount: 0,
        dateCreated: a.generatedAt,
        author: {
          "@type": "Organization",
          name: "Alpha by Mossland",
          url: SITE.baseUrl,
        },
      },
    },
    url: qaUrl,
  };

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(qaLd) }}
      />

      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <a href="/ask" className="hover:underline">Ask</a>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-snug">
          {a.question}
        </h1>
      </header>

      <article className="rounded-2xl border border-[var(--line)] bg-white p-6 mb-6">
        <p className="text-base leading-relaxed whitespace-pre-wrap">{a.answer}</p>
      </article>

      {a.citations.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            인용
          </h2>
          <div className="flex flex-wrap gap-2">
            {a.citations.map((c, i) => (
              <a
                key={i}
                href={c.url}
                className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs hover:border-[var(--moss)]"
              >
                {c.label}{" "}
                <span className="text-[10px] text-[var(--muted)]">({c.type})</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>마지막 답변: {new Date(a.generatedAt).toLocaleString("ko-KR")}</span>
        <span className="mx-2">·</span>
        <a href="/ask" className="hover:text-[var(--fg)]">
          새 질문하기 →
        </a>
        <span className="mx-2">·</span>
        <span>Alpha RAG · Grok</span>
      </footer>
    </main>
  );
}
