import { notFound } from "next/navigation";
import { getBriefEn, generateBriefEn } from "@/lib/brief-translate";
import { getBriefSummary } from "@/lib/brief";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE, pageOpenGraph } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { fmtKst } from "@/lib/health";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

type Props = { params: Promise<{ date: string }> };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(d + "T00:00:00Z");
  return !Number.isNaN(t);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  if (!isValidDate(date)) {
    return { title: `Brief ${date} (EN)`, robots: { index: false } };
  }
  const en = getBriefEn(date);
  const desc = en
    ? en.oneLine
    : `Daily brief for ${date} — Korean crypto, macro, and AI-narrative summary (English).`;
  return {
    title: `${date} Korean Crypto / Macro Brief — Alpha by Mossland`,
    description: desc,
    alternates: {
      canonical: `${SITE.baseUrl}/en/brief/${date}`,
      languages: {
        ko: `${SITE.baseUrl}/brief/${date}`,
        en: `${SITE.baseUrl}/en/brief/${date}`,
      },
    },
    openGraph: pageOpenGraph({
      title: `${date} — Alpha by Mossland`,
      description: desc,
      path: `/en/brief/${date}`,
      locale: "en_US",
    }),
  };
}

export default async function BriefEnPage({ params }: Props) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();

  // Generate-or-fetch — covers the case where Korean brief exists but
  // no English translation yet.
  const src = getBriefSummary(date);
  if (!src) notFound();

  let en = getBriefEn(date);
  if (!en) {
    try {
      const r = await generateBriefEn(date);
      en = r?.en ?? null;
    } catch {
      en = null;
    }
  }

  registerSeoPage({
    path: `/en/brief/${date}`,
    page_type: "brief",
    canonical_id: date,
    title: `${date} Korean Crypto Brief — Alpha by Mossland`,
    meta_description: en?.oneLine || `Daily brief for ${date} (EN).`,
    quality_score: 0.85,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "Alpha", href: "/" },
    { name: "Daily briefs (EN)", href: "/en" },
    { name: date, href: `/en/brief/${date}` },
  ]);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: en?.oneLine || `Korean Crypto Brief — ${date}`,
    datePublished: date + "T00:00:00+09:00",
    dateModified: en?.translatedAt || src.generatedAt,
    inLanguage: "en",
    author: { "@type": "Organization", name: "Mossland" },
    publisher: { "@type": "Organization", name: "Mossland" },
    description: en?.why || en?.oneLine || `Daily brief for ${date}`,
    url: `${SITE.baseUrl}/en/brief/${date}`,
  };

  return (
    <main id="main" lang="en" className="mx-auto w-full max-w-3xl px-6 py-10">
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
        <a href="/en" className="hover:underline">EN</a>
        <span className="mx-2">/</span>
        <span>Brief</span>
        <span className="mx-2">/</span>
        <span>{date}</span>
        <a
          href={`/brief/${date}`}
          className="ml-3 text-[var(--moss)] hover:underline"
          title="한국어 원문"
        >
          한국어 →
        </a>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          {date} Korean Crypto &amp; Macro Brief
        </h1>
        <p className="text-sm text-[var(--muted)]">
          What happened in Korea's crypto / macro markets that day —
          synthesized from Korean YouTube creators, news, and macro feeds.
        </p>
      </header>

      {!en ? (
        <section className="rounded-2xl border border-dashed border-[var(--line)] bg-zinc-50 p-5 text-sm text-zinc-600">
          English translation is being prepared. The original Korean brief
          is available at{" "}
          <a href={`/brief/${date}`} className="text-[var(--moss)] hover:underline">
            /brief/{date}
          </a>
          .
        </section>
      ) : (
        <>
          <article className="rounded-2xl bg-zinc-900 text-zinc-100 p-6 mb-8 shadow-lg">
            <header className="flex items-baseline gap-2 mb-3 text-xs text-zinc-400">
              <span className="font-mono text-sm text-[var(--accent)]">α</span>
              <span className="uppercase tracking-wider">Alpha Brief — EN</span>
              <span className="ml-auto font-mono">{fmtKst(en.translatedAt)}</span>
            </header>

            <p className="text-lg sm:text-xl font-semibold leading-snug mb-3">
              {en.oneLine}
            </p>

            {en.why && (
              <p className="text-sm text-zinc-300 leading-relaxed mb-5 border-l-2 border-[var(--accent)] pl-3">
                {en.why}
              </p>
            )}

            {en.points.length > 0 && (
              <ul className="space-y-1.5 mb-5 text-sm">
                {en.points.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[var(--accent)] font-mono text-xs mt-0.5">
                      {i + 1}.
                    </span>
                    <span className="text-zinc-200">{p}</span>
                  </li>
                ))}
              </ul>
            )}

            {en.quotes.length > 0 && (
              <div className="space-y-2 mb-5">
                {en.quotes.slice(0, 3).map((q, i) => (
                  <blockquote
                    key={i}
                    className="text-xs text-zinc-300 italic border-l border-zinc-600 pl-3"
                  >
                    “{q.text}” —{" "}
                    <span className="not-italic text-zinc-400">{q.source}</span>
                  </blockquote>
                ))}
              </div>
            )}

            <footer className="pt-3 border-t border-zinc-700 text-[10px] text-zinc-500">
              AI-translated by Alpha · Original Korean source:{" "}
              <a href={`/brief/${date}`} className="text-zinc-300 hover:underline">
                /brief/{date}
              </a>
            </footer>
          </article>

          <section className="rounded-2xl border border-[var(--line)] bg-white p-5 text-sm text-zinc-700 leading-relaxed">
            <h2 className="text-xs uppercase tracking-wider text-[var(--muted)] mb-2">
              About this brief
            </h2>
            <p>
              Alpha is a crypto × AI vertical media at{" "}
              <a href="/" className="text-[var(--moss)] hover:underline">alpha.moss.land</a> —
              channel-level stance distribution, AI-synthesized briefs, 8
              disclosed AI personas, hybrid RAG, and a 12-tool MCP server
              for Claude / Cursor. Brief is generated daily from Korean
              creators + news + macro feeds.
            </p>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Cite as: <em>Alpha by Mossland — alpha.moss.land/en/brief/{date}</em>
            </p>
          </section>
        </>
      )}

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)] flex flex-wrap gap-x-3 gap-y-1">
        <span>Mossland · alpha.moss.land</span>
        <span>·</span>
        <a href={`/brief/${date}`} className="hover:text-[var(--fg)]">
          Korean original
        </a>
        <span>·</span>
        <a href="/developers" className="hover:text-[var(--fg)]">
          Developer API
        </a>
      </footer>
    </main>
  );
}
