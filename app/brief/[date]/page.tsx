import { notFound } from "next/navigation";
import { getAllPulses, getAllTopics, getAllEvents } from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE, pageOpenGraph } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { PulseCard } from "@/components/PulseCard";
import { SynthesisCard } from "@/components/SynthesisCard";
import { getBriefSummary } from "@/lib/brief";
import { getBriefEn } from "@/lib/brief-translate";
import { kstClock, kstDayBounds } from "@/lib/kst";
import { fmtKst } from "@/lib/health";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

type Props = { params: Promise<{ date: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(d + "T00:00:00Z");
  if (Number.isNaN(t)) return false;
  // Date.parse rolls calendar overflow forward ("2026-02-30" → March 2) rather
  // than rejecting it, so a shape-valid but nonexistent date passed here and
  // reached the page as a 500 instead of a 404. Round-trip to catch that.
  return new Date(t).toISOString().slice(0, 10) === d;
}

// Brief dates are KST calendar days — lib/brief.ts generates each summary over
// `kstDayBounds`. Reading the same label with UTC bounds shifted this page's
// pulse/entity window nine hours off the summary it sits under.

/**
 * What this day's brief page is made of, and whether it should be indexed.
 *
 * One function for both generateMetadata and the page body, so the robots
 * meta and the seo_pages/sitemap policy cannot disagree — they did: the body
 * registered `noindex` for the in-progress day and printed "자정 후 인덱싱
 * 활성", while <head> inherited index,follow from the root layout.
 *
 * Only pulses and the AI summary count toward "is there content". Topic /
 * event / entity `updatedAt` is stamped by SignalMap's regeneration, so a
 * per-day filter on it is non-empty for the latest regen day only and empty
 * for every archived day (lib/brief.ts documents this and falls back for the
 * same reason). Gating on it made every past brief degrade to "없습니다" and
 * noindex within a day.
 */
function briefDay(date: string) {
  const { start, end } = kstDayBounds(date);
  const isToday = date === kstClock().date;
  const inDay = (iso: string) => {
    const t = Date.parse(iso);
    return t >= start && t < end;
  };
  const pulses = getAllPulses().filter((p) => inDay(p.detectedAt));
  const summary = getBriefSummary(date);
  const hasSummary = Boolean(summary && summary.points.length > 0);
  const substance = pulses.length + (hasSummary ? 3 : 0);
  const indexPolicy: "index" | "noindex" =
    isToday || substance < 3 ? "noindex" : "index";
  return { start, end, isToday, inDay, pulses, summary, hasSummary, substance, indexPolicy };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  if (!isValidDate(date)) {
    return { title: `Brief ${date}`, robots: { index: false } };
  }
  const { indexPolicy } = briefDay(date);
  const title = `${date} 시장 브리프 — Alpha`;
  const desc = `${date} 한국 크립토·매크로 시장 한 컷. Pulse·토픽·이벤트 정리.`;
  return {
    title,
    description: desc,
    // Must match the registerSeoPage policy below, or the sitemap and the
    // page disagree (same rule app/ask/q/[hash]/page.tsx follows).
    robots: indexPolicy === "noindex" ? { index: false, follow: true } : undefined,
    alternates: {
      canonical: `${SITE.baseUrl}/brief/${date}`,
      // Reciprocal hreflang — the English brief points back here — but only
      // when that page exists. /en/brief/[date] 404s for any day without a
      // translated summary (46 of the last 107 days have one), and this page
      // renders for every past day, so ~60 Korean briefs were sending every
      // crawler that honoured hreflang straight to a 404. Seen in the alpha
      // access log: Googlebot fetching /en/brief/2026-07-07 → 404.
      languages: getBriefEn(date)
        ? {
            ko: `${SITE.baseUrl}/brief/${date}`,
            en: `${SITE.baseUrl}/en/brief/${date}`,
          }
        : undefined,
    },
    openGraph: pageOpenGraph({ title, description: desc, path: `/brief/${date}` }),
  };
}

export default async function BriefPage({ params }: Props) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();

  // Compare KST label against KST today. Judging "future" by UTC midnight made
  // /today — which redirects to the KST date — 404 every day from KST 00:00
  // until 09:00, i.e. the whole morning the 08:30 brief is meant to be read.
  if (date > kstClock().date) notFound();

  const { end, isToday, inDay, pulses, summary: briefSummary, hasSummary, substance, indexPolicy } =
    briefDay(date);

  // Topics/events that carry this day's regeneration stamp. Shown when
  // present (that is the latest regen day); NOT counted as content — see
  // briefDay().
  const updatedTopics = getAllTopics().filter((t) => inDay(t.updatedAt));
  const updatedEvents = getAllEvents().filter((e) => inDay(e.updatedAt));

  registerSeoPage({
    path: `/brief/${date}`,
    page_type: "brief",
    canonical_id: date,
    title: `${date} 시장 브리프 — Alpha`,
    meta_description: `${date} pulse ${pulses.length}건${hasSummary ? " · AI 브리프" : ""}.`,
    index_policy: indexPolicy,
    quality_score: substance >= 5 ? 0.8 : substance >= 1 ? 0.4 : 0.1,
    lastmod: isToday ? new Date().toISOString() : new Date(end - 1).toISOString(),
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Brief", href: "/today" },
    { name: date, href: `/brief/${date}` },
  ]);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${date} 시장 브리프`,
    datePublished: date + "T00:00:00+09:00",
    dateModified: isToday ? new Date().toISOString() : `${date}T23:59:59+09:00`,
    author: { "@type": "Organization", name: "Mossland" },
    publisher: { "@type": "Organization", name: "Mossland" },
    description: `${date} 한국 크립토·매크로 시장 정리`,
    url: `${SITE.baseUrl}/brief/${date}`,
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
        <span>Brief</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          {date} 시장 브리프
        </h1>
        <p className="text-sm text-[var(--muted)]">
          이 날 한국 크립토·매크로 시장에서 무엇이 일어났나.
          {isToday && " (진행 중 — 자정 후 인덱싱 활성)"}
        </p>
      </header>

      {(() => {
        return briefSummary && briefSummary.points.length > 0 ? (
          <SynthesisCard
            synthesis={{
              oneLine: briefSummary.oneLine,
              why: briefSummary.why,
              points: briefSummary.points,
              quotes: briefSummary.quotes,
              generatedAt: briefSummary.generatedAt,
            }}
            refLabel={`${date} 일일 브리프`}
          />
        ) : null;
      })()}

      {/* 한 줄 요약 (데이터) */}
      <section className="mb-8">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
          한 줄 요약 (데이터)
        </h2>
        <p className="text-base">
          이 날 가격 시그널(pulse) {pulses.length}건
          {hasSummary ? " · AI 브리프 있음" : ""}.
        </p>
      </section>

      {pulses.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            가격 시그널
          </h2>
          <div className="space-y-3">
            {pulses.slice(0, 6).map((p) => (
              <PulseCard key={p.id} pulse={p} compact />
            ))}
          </div>
        </section>
      )}

      {updatedTopics.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            새로 다뤄진 토픽
          </h2>
          <ul className="space-y-2">
            {updatedTopics.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-baseline gap-2">
                <a
                  href={`/topic/${encodeURIComponent(t.id)}`}
                  className="text-[var(--moss)] hover:underline font-medium"
                >
                  {t.label}
                </a>
                <span className="text-xs text-[var(--muted)]">
                  · 영상 {t.videoCount}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {updatedEvents.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
            새 이벤트
          </h2>
          <ul className="space-y-2">
            {updatedEvents.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-baseline gap-2">
                <a
                  href={`/event/${encodeURIComponent(e.id)}`}
                  className="text-[var(--moss)] hover:underline font-medium"
                >
                  {e.label}
                </a>
                <span className="text-xs text-[var(--muted)]">
                  · 영상 {e.videoCount}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pulses.length === 0 && !hasSummary && updatedTopics.length === 0 && updatedEvents.length === 0 && (
        <section className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm text-[var(--muted)]">
          이 날에 추적된 pulse·토픽·이벤트가 없습니다.
        </section>
      )}

      {(() => {
        return (
          <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)] flex flex-wrap gap-x-3 gap-y-1">
            {briefSummary?.generatedAt && (
              <span className="font-mono">
                AI 합성: {fmtKst(briefSummary.generatedAt)}
              </span>
            )}
            <span>·</span>
            <span>출처: signalmap canonical (Mossland)</span>
            <span>·</span>
            <a href="/health" className="hover:text-[var(--fg)]">
              데이터 신선도 →
            </a>
          </footer>
        );
      })()}
    </main>
  );
}
