import { search } from "@/lib/search";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `"${q}" 검색 결과 — Alpha` : "검색 — Alpha",
    description: q
      ? `"${q}"에 대한 entity·topic·event·creator 검색 결과.`
      : "Alpha 통합 검색.",
    alternates: { canonical: `${SITE.baseUrl}/search` },
    robots: { index: false }, // 검색 결과 페이지는 noindex (Google guidance)
  };
}

const KIND_LABEL: Record<string, string> = {
  entity: "엔티티",
  topic: "토픽",
  event: "이벤트",
  creator: "채널",
};

export default async function SearchPage({ searchParams }: Props) {
  const { q = "" } = await searchParams;
  const hits = q ? search(q, 50) : [];

  registerSeoPage({
    path: "/search",
    page_type: "agent", // 검색은 SERP — schema 측면 emit하지 않음
    title: "검색 — Alpha",
    meta_description: "Alpha 통합 검색",
    index_policy: "noindex",
    quality_score: 0.1,
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Search</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight mb-3">검색</h1>
        <form action="/search" method="GET" className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="BTC, 이재명, FOMC, AI 코인…"
            className="flex-1 rounded-lg border border-[var(--line)] px-4 py-2 text-base focus:border-[var(--moss)] focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            className="rounded-lg bg-[var(--moss)] px-5 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            검색
          </button>
        </form>
      </header>

      {q && (
        <section>
          <h2 className="text-sm text-[var(--muted)] mb-4">
            “{q}” 검색 결과 — {hits.length}건
          </h2>

          {hits.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-zinc-50 p-6 text-sm text-[var(--muted)]">
              일치하는 결과가 없습니다. 키워드를 짧게 줄여보세요. 예: "BTC", "Fed",
              "이재명".
            </div>
          ) : (
            <ul className="space-y-2">
              {hits.map((h, i) => (
                <li key={`${h.kind}-${i}`}>
                  <a
                    href={h.href}
                    className="block rounded-lg border border-[var(--line)] bg-white p-4 hover:border-[var(--moss)]"
                  >
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                        {KIND_LABEL[h.kind] || h.kind}
                      </span>
                      <span className="text-sm font-medium">
                        {h.kind === "creator"
                          ? h.item.name
                          : h.item.label}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-[var(--muted)]">
                        {h.score}
                      </span>
                    </div>
                    {h.kind === "topic" && h.item.description && (
                      <p className="text-xs text-[var(--muted)] line-clamp-1">
                        {h.item.description}
                      </p>
                    )}
                    {(h.kind === "entity" || h.kind === "topic" || h.kind === "event") &&
                      "videoCount" in h.item && (
                        <div className="text-xs text-[var(--muted)]">
                          영상 {h.item.videoCount}편
                        </div>
                      )}
                    {h.kind === "creator" && h.item.notes && (
                      <p className="text-xs text-[var(--muted)] line-clamp-1">
                        {h.item.notes}
                      </p>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
