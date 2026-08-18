import { getActiveChannels } from "@/lib/creators";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE, pageOpenGraph } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 600;

export const metadata: Metadata = {
  title: "큐레이션된 채널 디렉토리 — Alpha",
  description: "Alpha가 추적하는 한국·글로벌 유튜브·뉴스 채널 디렉토리.",
  alternates: { canonical: `${SITE.baseUrl}/creators` },
  openGraph: pageOpenGraph({
    title: "큐레이션된 채널 디렉토리 — Alpha",
    description: "Alpha가 추적하는 한국·글로벌 유튜브·뉴스 채널 디렉토리.",
    path: "/creators",
    type: "website",
  }),
};

const CATEGORY_LABEL: Record<string, string> = {
  economy: "경제",
  tech: "테크",
  news: "뉴스/시사",
  science: "과학",
};

export default function CreatorsIndex() {
  const channels = getActiveChannels();

  registerSeoPage({
    path: "/creators",
    page_type: "creator",
    title: "큐레이션된 채널 디렉토리 — Alpha",
    meta_description: `Alpha 추적 채널 ${channels.length}개`,
    quality_score: channels.length > 10 ? 0.7 : 0.4,
  });

  // group by category
  const byCategory = channels.reduce<Record<string, typeof channels>>((acc, c) => {
    const k = c.category || "other";
    (acc[k] ||= []).push(c);
    return acc;
  }, {});

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Creators</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          채널 디렉토리
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Alpha가 분석 중인 한국·글로벌 유튜브·뉴스 채널 {channels.length}개.
          각 채널의 fingerprint(자주 다루는 엔티티 · stance 분포)를 클릭으로 확인.
        </p>
      </header>

      {Object.entries(byCategory).map(([cat, list]) => (
        <section key={cat} className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            {CATEGORY_LABEL[cat] || cat} · {list.length}
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {list.map((c) => (
              <li key={c.youtube_channel_id || c.name}>
                <a
                  href={`/creator/${c.youtube_channel_id}`}
                  className="block rounded-lg border border-[var(--line)] bg-white px-3 py-2 hover:border-[var(--moss)]"
                >
                  <div className="text-sm font-medium">{c.name}</div>
                  {c.notes && (
                    <div className="text-xs text-[var(--muted)] mt-0.5 line-clamp-1">
                      {c.notes}
                    </div>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>출처: signalmap seed/channels.json</span>
      </footer>
    </main>
  );
}
