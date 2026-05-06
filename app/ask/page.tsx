import { listRecentAnswers } from "@/lib/ask";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import type { Metadata } from "next";
import { AskClient } from "./AskClient";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Ask Alpha — 한국 크립토·매크로 질문 답변",
  description:
    "Alpha의 entity·topic·event 데이터에 자연어로 질문. AI가 인용 + 출처와 함께 답변.",
  alternates: { canonical: `${SITE.baseUrl}/ask` },
};

export default function AskPage() {
  const recent = listRecentAnswers(20);

  registerSeoPage({
    path: "/ask",
    page_type: "agent",
    title: "Ask Alpha",
    meta_description: "한국 크립토·매크로 질문 답변",
    quality_score: 0.6,
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Ask</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
          Ask Alpha
        </h1>
        <p className="text-base leading-relaxed text-zinc-700">
          Alpha의 데이터(141 entity · 22 topic · 31 event · 506 video)에 자연어로
          질문하세요. AI가 인용·출처와 함께 답변합니다.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          ⚠ 가격 권유·정치 비방·단정 X. 컨텍스트에 없는 내용은 답변 불가.
        </p>
      </header>

      <AskClient />

      {recent.length > 0 && (
        <section className="mt-12">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            최근 질문
          </h2>
          <ul className="space-y-2">
            {recent.map((r) => (
              <li key={r.hash}>
                <a
                  href={`/ask/q/${r.hash}`}
                  className="block rounded-lg border border-[var(--line)] bg-white px-4 py-2 hover:border-[var(--moss)]"
                >
                  <div className="text-sm">{r.question}</div>
                  <div className="text-xs text-[var(--muted)] mt-0.5">
                    {new Date(r.generated_at).toLocaleString("ko-KR")}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-16 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>RAG over Alpha canonical store · Grok-4-1-fast-non-reasoning</span>
        <span className="mx-2">·</span>
        <span>모든 답변은 출처 링크와 함께</span>
      </footer>
    </main>
  );
}
