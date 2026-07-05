import { notFound } from "next/navigation";
import { getPulse } from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { PulseCard } from "@/components/PulseCard";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = getPulse(id);
  if (!p) return { title: `Pulse ${id}`, robots: { index: false } };
  const dirSign = p.direction === "up" ? "+" : "-";
  const title = `${p.assetLabel || p.asset} ${dirSign}${Math.abs(p.magnitudePct).toFixed(2)}% — Pulse ${id}`;
  return {
    title,
    description: p.summary.slice(0, 200),
    alternates: { canonical: `${SITE.baseUrl}/pulse/${id}` },
  };
}

export default async function PulseDetail({ params }: Props) {
  const { id } = await params;
  const p = getPulse(id);
  if (!p) notFound();

  const idxPolicy: "index" | "noindex" =
    p.synthesisState === "raw" || p.synthesisState === "pending"
      ? "noindex"
      : "index";

  registerSeoPage({
    path: `/pulse/${id}`,
    page_type: "event",
    canonical_id: id,
    title: `${p.assetLabel || p.asset} 가격 시그널 — ${id}`,
    meta_description: p.summary.slice(0, 200),
    index_policy: idxPolicy,
    quality_score:
      p.synthesisState === "reviewed" ? 0.9 : p.synthesisState === "enriched" ? 0.7 : 0.2,
    lastmod: p.verifiedAt || p.detectedAt,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Pulse", href: "/pulse" },
    { name: id, href: `/pulse/${id}` },
  ]);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: `${p.assetLabel || p.asset} ${
      p.direction === "up" ? "상승" : "하락"
    } ${Math.abs(p.magnitudePct).toFixed(2)}%`,
    datePublished: p.detectedAt,
    dateModified: p.verifiedAt || p.detectedAt,
    author: { "@type": "Organization", name: "Mossland" },
    publisher: { "@type": "Organization", name: "Mossland" },
    description: p.summary.slice(0, 300),
    url: `${SITE.baseUrl}/pulse/${id}`,
  };

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

      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <a href="/pulse" className="hover:underline">Pulse</a>
        <span className="mx-2">/</span>
        <span className="font-mono">{id}</span>
      </nav>

      <PulseCard pulse={p} />

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>출처: signalmap pulse · {p.confidence}</span>
      </footer>
    </main>
  );
}
