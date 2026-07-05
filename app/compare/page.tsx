import { listComparisons } from "@/lib/comparisons";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "비교 — Alpha",
  description: "AI 검색 비교 질의 직격. 자산·채널·narrative 양 측 시각 정리.",
  alternates: { canonical: `${SITE.baseUrl}/compare` },
};

const CATEGORY_LABEL: Record<string, string> = {
  asset: "자산",
  channel: "채널",
  narrative: "narrative",
  "korea-vs-global": "한국 vs 글로벌",
};

export default function CompareIndex() {
  const list = listComparisons();

  registerSeoPage({
    path: "/compare",
    page_type: "compare",
    title: "비교 — Alpha",
    meta_description: `${list.length}개 큐레이션된 비교`,
    quality_score: 0.7,
  });

  const byCategory = list.reduce<Record<string, typeof list>>((acc, c) => {
    (acc[c.category] ||= []).push(c);
    return acc;
  }, {});

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Compare</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          비교
        </h1>
        <p className="text-sm text-[var(--muted)]">
          자산·채널·narrative의 양 측 시각을 한 화면에. AI 검색이 비교
          질의에 답할 때 인용하기 좋은 페이지.
        </p>
      </header>

      {Object.entries(byCategory).map(([cat, items]) => (
        <section key={cat} className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            {CATEGORY_LABEL[cat] || cat}
          </h2>
          <ul className="space-y-2">
            {items.map((c) => (
              <li key={c.slug}>
                <a
                  href={`/compare/${c.slug}`}
                  className="block rounded-2xl border border-[var(--line)] bg-white p-4 hover:border-[var(--moss)]"
                >
                  <div className="text-base font-semibold mb-1.5">{c.title}</div>
                  <p className="text-sm text-zinc-700 leading-relaxed line-clamp-2">
                    {c.oneLineSummary}
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
