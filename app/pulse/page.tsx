import { getActivePulses, getAllPulses } from "@/lib/mic";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import { jsonLdScript, breadcrumbJsonLd } from "@/lib/jsonld";
import { PulseCard } from "@/components/PulseCard";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Pulse — 가격 쇼크 즉시 정리",
  description: "BTC·ETH·기타 자산의 분 단위 가격 시그널과 보도 매칭.",
  alternates: { canonical: `${SITE.baseUrl}/pulse` },
};

export default function PulseIndex() {
  const active = getActivePulses(72);
  const archived = getAllPulses().slice(active.length, active.length + 30);

  registerSeoPage({
    path: "/pulse",
    page_type: "event",
    title: "Pulse — 가격 쇼크 즉시 정리",
    meta_description: "BTC·ETH·기타 자산 분 단위 가격 시그널",
    quality_score: active.length > 0 ? 0.7 : 0.4,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", href: "/" },
    { name: "Pulse", href: "/pulse" },
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <nav className="text-xs text-[--color-muted] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Pulse</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
          Pulse — 가격 쇼크 즉시 정리
        </h1>
        <p className="text-sm text-[--color-muted]">
          5분 윈도우 1% 이상 변동 자동 감지. raw → enriched → reviewed 단계로
          승급. 보도 매칭 후 사후 검증 라벨링.
        </p>
      </header>

      {active.length > 0 ? (
        <section className="mb-10">
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
            활성 (지난 72시간)
          </h2>
          <div className="space-y-4">
            {active.map((p) => (
              <PulseCard key={p.id} pulse={p} />
            ))}
          </div>
        </section>
      ) : (
        <section className="mb-10 rounded-2xl border border-[--color-line] bg-white p-6 text-sm text-[--color-muted]">
          최근 72시간 활성 펄스 없음. signalmap이 5분 윈도우로 모니터링 중.
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3">
            지난 펄스 ({archived.length})
          </h2>
          <div className="space-y-3">
            {archived.map((p) => (
              <PulseCard key={p.id} pulse={p} compact />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
