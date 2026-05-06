import { notFound } from "next/navigation";
import {
  getAllPulses,
  getAllEntities,
  getAllTopics,
  getAllEvents,
  getActivePulses,
} from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { PulseCard } from "@/components/PulseCard";
import { SynthesisCard } from "@/components/SynthesisCard";
import { getBriefSummary } from "@/lib/brief";
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

function dayBounds(date: string): { start: number; end: number } {
  const start = Date.parse(date + "T00:00:00Z");
  const end = start + 24 * 3600_000;
  return { start, end };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  if (!isValidDate(date)) {
    return { title: `Brief ${date}`, robots: { index: false } };
  }
  const title = `${date} 시장 브리프 — Alpha`;
  const desc = `${date} 한국 크립토·매크로 시장 한 컷. Pulse·토픽·이벤트 정리.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `${SITE.baseUrl}/brief/${date}` },
    openGraph: { title, description: desc, type: "article" },
  };
}

export default async function BriefPage({ params }: Props) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();

  const { start, end } = dayBounds(date);
  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;
  const isFuture = Date.parse(date + "T00:00:00Z") > Date.now();

  if (isFuture) notFound();

  const pulses = getAllPulses().filter((p) => {
    const t = Date.parse(p.detectedAt);
    return t >= start && t < end;
  });

  // entities/topics/events updated within this day
  const updatedToday = (iso: string) => {
    const t = Date.parse(iso);
    return t >= start && t < end;
  };
  const updatedTopics = getAllTopics().filter((t) => updatedToday(t.updatedAt));
  const updatedEvents = getAllEvents().filter((e) => updatedToday(e.updatedAt));
  const updatedEntities = getAllEntities().filter((e) =>
    updatedToday(e.updatedAt)
  );

  const total = pulses.length + updatedTopics.length + updatedEvents.length;

  // 오늘 진행중 = noindex, 어제 이전 = index (after midnight)
  const indexPolicy = isToday ? "noindex" : total >= 3 ? "index" : "noindex";

  registerSeoPage({
    path: `/brief/${date}`,
    page_type: "brief",
    canonical_id: date,
    title: `${date} 시장 브리프 — Alpha`,
    meta_description: `${date} pulse ${pulses.length}건, 토픽 ${updatedTopics.length}, 이벤트 ${updatedEvents.length}.`,
    index_policy: indexPolicy,
    quality_score: total >= 5 ? 0.8 : total >= 1 ? 0.4 : 0.1,
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
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
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
        const briefSummary = getBriefSummary(date);
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
          이 날 pulse {pulses.length}건, 갱신된 토픽 {updatedTopics.length},
          이벤트 {updatedEvents.length}, 엔티티 {updatedEntities.length}.
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

      {total === 0 && (
        <section className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm text-[var(--muted)]">
          이 날에 추적된 pulse·토픽·이벤트가 없습니다.
        </section>
      )}

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>마지막 업데이트: {new Date().toLocaleString("ko-KR")}</span>
        <span className="mx-2">·</span>
        <span>출처: signalmap canonical (Mossland)</span>
      </footer>
    </main>
  );
}
