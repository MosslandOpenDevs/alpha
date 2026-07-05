import { listEnDates } from "@/lib/brief-translate";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 600;

export const metadata: Metadata = {
  title: "Alpha by Mossland — Daily Korean Crypto Briefs (EN)",
  description:
    "English daily briefs of Korean crypto, macro, and AI-narrative markets. AI-synthesized from Korean YouTube, news, and macro feeds. Free, citable, MIT-licensed code at alpha.moss.land.",
  alternates: {
    canonical: `${SITE.baseUrl}/en`,
    languages: { ko: `${SITE.baseUrl}/`, en: `${SITE.baseUrl}/en` },
  },
};

export default function EnIndex() {
  const dates = listEnDates();
  registerSeoPage({
    path: "/en",
    page_type: "brief",
    title: "Alpha — Korean Crypto Briefs (EN)",
    meta_description: "English-language Korean crypto / macro daily briefs.",
    quality_score: 0.8,
  });

  return (
    <main id="main" lang="en" className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>EN</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
          Alpha — Korean crypto in English
        </h1>
        <p className="text-base sm:text-lg leading-relaxed text-zinc-700">
          Daily briefs of Korean crypto, macro, and AI-narrative markets,
          translated from the original Korean. Synthesized from Korean
          YouTube creators, news outlets, and macro feeds (BOK ECOS + FRED).
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          The original Korean platform is at{" "}
          <a href="/" className="text-[var(--moss)] hover:underline">alpha.moss.land</a>.
          Free public API + 12-tool MCP server for Claude / Cursor —{" "}
          <a href="/developers" className="text-[var(--moss)] hover:underline">/developers</a>.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          Recent briefs
        </h2>
        {dates.length === 0 ? (
          <p className="text-sm text-zinc-600 rounded-2xl border border-dashed border-[var(--line)] bg-zinc-50 p-5">
            English briefs will appear here as they are generated. The
            translation runs daily after the Korean brief lands.
          </p>
        ) : (
          <ul className="space-y-2">
            {dates.slice(0, 30).map((d) => (
              <li
                key={d}
                className="rounded-xl border border-[var(--line)] bg-white px-4 py-3"
              >
                <a
                  href={`/en/brief/${d}`}
                  className="font-mono text-sm hover:text-[var(--moss)]"
                >
                  {d}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 text-sm text-zinc-700 leading-relaxed mb-6">
        <h2 className="text-base font-semibold mb-2">What's inside Alpha</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>141+ canonical entities, 22 topics, 506+ analyzed Korean videos</li>
          <li>Channel-level stance distribution (who's bull, who's bear, why)</li>
          <li>8 disclosed AI personas with auto-resolving 7-day price calls (composite synthesis, not 1:1 mimics)</li>
          <li>Hybrid keyword + embedding RAG Q&amp;A at <code>/api/ask</code></li>
          <li>12-tool MCP server at <code>/api/mcp</code> (Claude / Cursor / Cline / Continue / Zed)</li>
          <li>KR macro snapshot (BOK ECOS + FRED) updated daily</li>
        </ul>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Free quotation welcome. Suggested attribution:{" "}
          <em>"Alpha by Mossland — alpha.moss.land/en/brief/[date]"</em>.
        </p>
      </section>

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)] flex flex-wrap gap-x-3 gap-y-1">
        <span>Mossland · MIT-licensed</span>
        <span>·</span>
        <a href="/" className="hover:text-[var(--fg)]">한국어 (original)</a>
        <span>·</span>
        <a href="https://github.com/MosslandOpenDevs/alpha" className="hover:text-[var(--fg)]">GitHub</a>
        <span>·</span>
        <a href="/developers" className="hover:text-[var(--fg)]">Developer API</a>
      </footer>
    </main>
  );
}
