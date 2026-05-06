import { listExplainers } from "@/lib/explainers";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "개념 설명 — Alpha",
  description: "크립토·매크로·AI 핵심 개념을 5-블록으로 정리.",
  alternates: { canonical: `${SITE.baseUrl}/explain` },
};

const CATEGORY_LABEL: Record<string, string> = {
  crypto: "크립토",
  macro: "매크로",
  korea: "한국 시장",
  mossland: "Mossland",
  ai: "AI",
};

export default function ExplainIndex() {
  const list = listExplainers();

  registerSeoPage({
    path: "/explain",
    page_type: "topic",
    title: "개념 설명 — Alpha",
    meta_description: `${list.length}개 큐레이션된 explainer`,
    quality_score: 0.8,
  });

  const byCategory = list.reduce<Record<string, typeof list>>((acc, ex) => {
    (acc[ex.category] ||= []).push(ex);
    return acc;
  }, {});

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-[--color-muted] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Explain</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          개념 설명
        </h1>
        <p className="text-sm text-[--color-muted]">
          크립토·매크로·AI·한국 시장의 핵심 개념을 5분 안에 이해하도록 정리.
        </p>
      </header>

      {Object.entries(byCategory).map(([cat, items]) => (
        <section key={cat} className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
            {CATEGORY_LABEL[cat] || cat}
          </h2>
          <ul className="space-y-2">
            {items.map((ex) => (
              <li key={ex.slug}>
                <a
                  href={`/explain/${ex.slug}`}
                  className="block rounded-2xl border border-[--color-line] bg-white p-4 hover:border-[--color-moss]"
                >
                  <div className="text-base font-semibold mb-1.5">{ex.title}</div>
                  <p className="text-sm text-zinc-700 leading-relaxed line-clamp-2">
                    {ex.oneLine}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
