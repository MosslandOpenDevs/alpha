import { upsertSeoPage } from "@/lib/db";
import { SITE } from "@/lib/seo";

/**
 * Home — Phase 0 placeholder.
 * 답변 가능 5-블록 구조 (alpha_dev_plan §2.3) 적용.
 * 도메인이 *살아있다*는 신호 + SEO 인프라 동작 확인 surface.
 */

export const dynamic = "force-dynamic";

const LAUNCH_DATE = "2026-05-06";

function ensureHomeRegistered() {
  upsertSeoPage({
    path: "/",
    page_type: "home",
    canonical_id: null,
    title: `${SITE.longName} — 오늘의 알파, 모든 시각으로`,
    meta_description: SITE.description,
    index_policy: "index",
    lastmod: new Date().toISOString(),
    generated_at: new Date().toISOString(),
    quality_score: 0.5,
  });
}

export default function Home() {
  ensureHomeRegistered();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-20">
      <header className="mb-10 flex items-baseline gap-3">
        <span
          aria-hidden
          className="font-mono text-2xl text-[--color-moss]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          α
        </span>
        <h1
          className="text-3xl sm:text-4xl font-semibold tracking-tight"
          style={{ color: "var(--fg)" }}
        >
          Alpha <span className="text-[--color-muted] font-normal">by Mossland</span>
        </h1>
        <span className="ml-auto text-xs uppercase tracking-wider text-[--color-muted]">
          [beta · phase 0]
        </span>
      </header>

      {/* 답변 가능 5-블록 구조 (LLM citation friendly) */}

      {/* H1 = 사용자 질문 형태 */}
      <section className="mb-10">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Alpha는 무엇이고 왜 만들었나?
        </h2>

        {/* [블록 1] 한 줄 요약 */}
        <p className="mt-4 text-lg leading-relaxed">
          Alpha는 크립토·매크로·국제정세를 AI로 요약·연결하고, 그 자리에서
          익명으로 토론하는 한국형 미디어 커뮤니티입니다.
        </p>
      </section>

      {/* [블록 2] 핵심 포인트 5개 */}
      <section className="mb-10 border-l-2 border-[--color-moss] pl-5">
        <h3 className="text-base font-semibold mb-3 uppercase tracking-wider text-[--color-muted]">
          핵심 5가지
        </h3>
        <ol className="space-y-2 list-decimal list-inside leading-relaxed">
          <li>
            <strong>같은 이슈, 모든 시각</strong> — 영상·기사·소셜의 입장이
            한 카드 안에 정리됩니다.
          </li>
          <li>
            <strong>분 단위 freshness</strong> — 가격 쇼크 즉시 카드, 5/15/30분
            enrichment.
          </li>
          <li>
            <strong>연결 엔진</strong> — 카드끼리 인과 가설을 LLM이 1줄로 잇습니다.
          </li>
          <li>
            <strong>익명 verified 커뮤니티</strong> — 닉네임은 자동 생성, 지갑·
            거래소·산업 인증으로 자리 증명.
          </li>
          <li>
            <strong>영구 URL 자산</strong> — 모든 카드가 시간이 지나도 검색 가능한
            지식 자산으로 남습니다.
          </li>
        </ol>
      </section>

      {/* [블록 3] 대표 인용 — Phase 0이라 placeholder */}
      <section className="mb-10">
        <h3 className="text-base font-semibold mb-3 uppercase tracking-wider text-[--color-muted]">
          Phase 0 상태
        </h3>
        <div className="rounded-2xl border border-[--color-line] bg-white p-5 text-sm leading-relaxed">
          <p>
            지금 이 페이지는 <strong>Phase 0 placeholder</strong>입니다. 도메인이
            살아 있고, SEO 인프라(robots.txt · sitemap.xml · llms.txt · rss.xml ·
            JSON-LD · seo_pages 단일 출처)가 동작합니다.
          </p>
          <p className="mt-2 text-[--color-muted]">
            Phase 1에서 카드 빌더 + 홈 매거진 + Pulse가 추가됩니다.
          </p>
        </div>
      </section>

      {/* [블록 4] 출처 / 링크 */}
      <section className="mb-10">
        <h3 className="text-base font-semibold mb-3 uppercase tracking-wider text-[--color-muted]">
          관련 surface
        </h3>
        <ul className="space-y-1 text-sm">
          <li>
            <a
              href="/robots.txt"
              className="text-[--color-moss] underline-offset-2 hover:underline"
            >
              /robots.txt
            </a>
            <span className="text-[--color-muted]"> — 검색봇·사용자봇·학습봇 3분류 정책</span>
          </li>
          <li>
            <a
              href="/llms.txt"
              className="text-[--color-moss] underline-offset-2 hover:underline"
            >
              /llms.txt
            </a>
            <span className="text-[--color-muted]"> — LLM 친화 사이트 인덱스</span>
          </li>
          <li>
            <a
              href="/sitemap.xml"
              className="text-[--color-moss] underline-offset-2 hover:underline"
            >
              /sitemap.xml
            </a>
            <span className="text-[--color-muted]"> — 색인 가능한 모든 URL</span>
          </li>
          <li>
            <a
              href="/rss.xml"
              className="text-[--color-moss] underline-offset-2 hover:underline"
            >
              /rss.xml
            </a>
            <span className="text-[--color-muted]"> — 최근 발행 feed</span>
          </li>
          <li>
            <a
              href="/api/health"
              className="text-[--color-moss] underline-offset-2 hover:underline"
            >
              /api/health
            </a>
            <span className="text-[--color-muted]"> — service health</span>
          </li>
          <li>
            <a
              href="https://moss.land"
              className="text-[--color-moss] underline-offset-2 hover:underline"
            >
              moss.land
            </a>
            <span className="text-[--color-muted]"> — Mossland 본진</span>
          </li>
        </ul>
      </section>

      {/* [블록 5] 마지막 업데이트 */}
      <footer className="mt-16 border-t border-[--color-line] pt-6 text-xs text-[--color-muted] flex flex-wrap gap-4">
        <span>마지막 업데이트: {LAUNCH_DATE}</span>
        <span>·</span>
        <span>운영: Mossland</span>
        <span>·</span>
        <a href="https://moss.land" className="hover:text-[--color-fg]">
          moss.land
        </a>
        <span>·</span>
        <a href="https://disclosure.moss.land" className="hover:text-[--color-fg]">
          disclosure
        </a>
      </footer>
    </main>
  );
}
