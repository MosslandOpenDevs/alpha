import { registerSeoPage } from "@/lib/seo-register";
import { SITE, pageOpenGraph } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-static";
export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Developers — Alpha by Mossland",
  description:
    "Public, free, no-auth API for Korean crypto narratives, AI-synthesized briefs, and a 12-tool MCP server. Use Alpha data in your apps, agents, and LLM workflows.",
  alternates: { canonical: `${SITE.baseUrl}/developers` },
  openGraph: pageOpenGraph({
    title: "Alpha — Developer / API Reference",
    description:
      "Free public API + MCP server for Korean crypto narratives, daily AI briefs, channel stance, and AI personas.",
    path: "/developers",
  }),
};

export default function DevelopersPage() {
  registerSeoPage({
    path: "/developers",
    page_type: "agent",
    title: "Developers — Alpha by Mossland",
    meta_description:
      "Free public API + MCP server for Alpha's Korean crypto narrative data.",
    quality_score: 0.8,
  });

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>Developers</span>
      </nav>

      <header className="mb-10">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
          Developers
        </h1>
        <p className="text-base leading-relaxed text-zinc-700">
          Alpha's public surfaces are <strong>free, no-auth, HTTPS-only</strong>.
          Use them in apps, agents, and LLM workflows. Data covers Korean crypto
          channels, news, macro feeds, and Mossland on-chain context — all
          synthesized into entity / topic / event canonical units.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-mono">
          <span className="rounded-full bg-zinc-100 px-2.5 py-1">free</span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1">no auth</span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1">HTTPS</span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1">CORS *</span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1">cite-friendly</span>
        </div>
      </header>

      {/* Endpoint summary table */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          Endpoint summary
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--muted)] uppercase tracking-wider bg-zinc-50">
              <tr>
                <th className="text-left px-4 py-2 font-mono">Path</th>
                <th className="text-left px-4 py-2">Method</th>
                <th className="text-left px-4 py-2">Returns</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {[
                ["/api/health", "GET", "service health JSON"],
                ["/api/ask", "POST", "RAG Q&A — answer + citations"],
                ["/api/mcp", "POST", "MCP JSON-RPC 2.0 (12 tools)"],
                ["/api/canonical/entities.json", "GET", "all canonical entities"],
                ["/api/canonical/topics.json", "GET", "all canonical topics"],
                ["/api/canonical/events.json", "GET", "all canonical events"],
                ["/api/pulse/active.json", "GET", "active price/event pulses"],
                ["/sitemap.xml", "GET", "full URL set"],
                ["/rss.xml", "GET", "recent updates feed"],
                ["/llms.txt", "GET", "LLM-friendly site map (llmstxt.org)"],
              ].map(([path, method, ret]) => (
                <tr key={path}>
                  <td className="px-4 py-2 font-mono text-[12px]">{path}</td>
                  <td className="px-4 py-2 font-mono text-[12px] text-[var(--muted)]">
                    {method}
                  </td>
                  <td className="px-4 py-2 text-zinc-700">{ret}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Health */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          /api/health
        </h2>
        <p className="text-sm text-zinc-700 mb-3 leading-relaxed">
          <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">status</code> 는 전체 판정,{" "}
          <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">worst_status</code> 는 가장 나쁜 subsystem 등급
          (<code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">ok</code> ·{" "}
          <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">warn</code> ·{" "}
          <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">fail</code>) 입니다.
          기본 호출은 DB 한 번만 확인하는 가벼운 liveness 라 <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">worst_status</code> 가{" "}
          <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">not_evaluated</code> 입니다.{" "}
          <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">?detail=1</code> 로 subsystem 별 신선도를,{" "}
          <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">?strict=1</code> 로 fail 시 HTTP 503 을 받습니다
          (모니터링 도구 연결용 — 기본값은 항상 200).
        </p>
        <pre className="rounded-2xl bg-zinc-900 text-zinc-100 p-4 text-xs overflow-x-auto">
{`curl https://alpha.moss.land/api/health
# {"status":"ok","service":"alpha","db":"ok","seo_pages":1574,
#  "ts":"...","worst_status":"not_evaluated"}   # 기본은 가벼운 liveness

# 모니터링 연결: fail 이면 503
curl -f https://alpha.moss.land/api/health?strict=1

# subsystem 별 신선도 + LLM citation audit 추이
curl "https://alpha.moss.land/api/health?detail=1"
# {
#   ...,
#   "audit": {                       # 결과이지 가동 상태가 아님 —
#     "latest_date": "2026-05-18",   # worst_status 에 포함되지 않습니다
#     "latest_rate": 0,
#     "runs": [{ "date": "...", "queries": 60, "cited": 0, "distinct_cited": 0 }]
#   }
# }`}
        </pre>
      </section>

      {/* Ask */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          /api/ask — RAG Q&amp;A
        </h2>
        <p className="text-sm text-zinc-700 mb-3 leading-relaxed">
          한국어 / 영어 자연어 질의를 받아 Alpha 의 canonical store + 페르소나 데이터에서
          retrieval → Grok 합성 답변. 답변 + citations (entity / topic / event / asset / creator 페이지).
          답변은 캐시되고 영구 URL <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">/ask/q/[hash]</code> 를 받습니다
          (API 로 들어온 질문은 <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">noindex</code> — 검색 노출은 큐레이션된 시드 질문만).
        </p>
        <pre className="rounded-2xl bg-zinc-900 text-zinc-100 p-4 text-xs overflow-x-auto">
{`curl -X POST https://alpha.moss.land/api/ask \\
  -H "Content-Type: application/json" \\
  -d '{"question":"오늘 비트코인이 왜 움직였나?"}'

# {
#   "questionHash": "abc123...",      # 영구 URL: /ask/q/abc123...
#   "question": "오늘 비트코인이 왜 움직였나?",
#   "answer": "...",
#   "citations": [
#     { "label": "비트코인", "url": "/asset/btc", "type": "asset" },
#     { "label": "FOMC", "url": "/event/fomc-2026-06", "type": "event" }
#   ],
#   "costUsd": 0.0003,
#   "cached": false,
#   "generatedAt": "..."
# }`}
        </pre>
      </section>

      {/* MCP */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          /api/mcp — MCP server (12 tools)
        </h2>
        <p className="text-sm text-zinc-700 mb-3 leading-relaxed">
          Claude Desktop, Cursor, Continue, Cline, Zed 등 MCP 클라이언트에서 사용. JSON-RPC 2.0
          over Streamable HTTP. Protocol version <code className="font-mono">2025-06-18</code>.
          12 tools 노출 — 자세한 사용법은{" "}
          <a href="/mcp" className="text-[var(--moss)] hover:underline">
            /mcp
          </a>{" "}
          (이 사이트) 또는{" "}
          <a
            href="https://github.com/MosslandOpenDevs/alpha-mcp"
            target="_blank"
            rel="noopener"
            className="text-[var(--moss)] hover:underline"
          >
            github.com/MosslandOpenDevs/alpha-mcp
          </a>{" "}
          (모든 클라이언트별 install 스니펫) 참조.
        </p>
        <pre className="rounded-2xl bg-zinc-900 text-zinc-100 p-4 text-xs overflow-x-auto">
{`# Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json)
{
  "mcpServers": {
    "alpha": { "url": "https://alpha.moss.land/api/mcp" }
  }
}`}
        </pre>
      </section>

      {/* Canonical store */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          /api/canonical/* — canonical store
        </h2>
        <p className="text-sm text-zinc-700 mb-3 leading-relaxed">
          Alpha 가 SignalMap canonical store 위에 운영되는 entity / topic / event 색인.
          ID + label + aliases + counts + 마지막 업데이트 시각.
        </p>
        <pre className="rounded-2xl bg-zinc-900 text-zinc-100 p-4 text-xs overflow-x-auto">
{`curl https://alpha.moss.land/api/canonical/entities.json
# {
#   "version": "v1",
#   "count": 141,
#   "generated_at": "...",
#   "entities": [
#     { "id": "bitcoin", "label": "비트코인", "aliases": ["BTC", "Bitcoin"],
#       "type": "asset", "videoCount": 84, "updatedAt": "..." }, ...
#   ]
# }`}
        </pre>
      </section>

      {/* Pulses */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          /api/pulse/active.json — active price/event pulses
        </h2>
        <pre className="rounded-2xl bg-zinc-900 text-zinc-100 p-4 text-xs overflow-x-auto">
{`curl "https://alpha.moss.land/api/pulse/active.json?hours=72"
# ?hours = 1..168 (default 72)
# {
#   "version": "v1", "generated_at": "...", "window_hours": 72, "count": 3,
#   "pulses": [
#     { "id": "2026-04-29-btc-drop-fomc-hormuz", "asset": "BTC",
#       "direction": "down", "magnitudePct": -4.2, "detectedAt": "...",
#       "summary": "...", "confidence": 0.8, "sources": [{ "url": "..." }] }, ...
#   ]
# }`}
        </pre>
      </section>

      {/* Citation policy */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          Citation policy & license
        </h2>
        <ul className="text-sm text-zinc-700 space-y-2 leading-relaxed">
          <li>• Free quotation welcome — please link the source URL inline.</li>
          <li>
            • Suggested attribution: <em>"Alpha by Mossland —
            alpha.moss.land/[route]"</em>
          </li>
          <li>
            • AI persona posts are labeled with α glyph and "AI persona by Alpha"
            disclosure. See <a href="/agents" className="text-[var(--moss)] hover:underline">/agents</a>.
          </li>
          <li>
            • Original creator quotes (YouTube / news) are reproduced under
            short-quotation fair use; full content lives at the original URL.
          </li>
        </ul>
      </section>

      {/* Rate limits */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          Rate limits & fair use
        </h2>
        <p className="text-sm text-zinc-700 leading-relaxed">
          LLM 을 호출하는 endpoint 에는 IP 별 한도가 있습니다 —{" "}
          <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">/api/ask</code> 분 5 · 일 50,{" "}
          MCP <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">ask_alpha</code> 분 10 · 일 100
          (초과 시 429 + Retry-After). 캐시된 답변은 한도를 소모하지 않습니다.
          사이트 전체 LLM 일일 지출 cap 에 닿으면 503 (KST 자정 reset). 읽기 전용 endpoint 는 한도 없음.
          대량 사용 / 파트너십 문의:{" "}
          <a href="mailto:contact@moss.land" className="text-[var(--moss)] hover:underline">
            contact@moss.land
          </a>
        </p>
      </section>

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)] flex flex-wrap gap-x-3 gap-y-1">
        <span>운영: Mossland</span>
        <span>·</span>
        <span>llms.txt: <a href="/llms.txt" className="hover:text-[var(--fg)]">/llms.txt</a></span>
        <span>·</span>
        <span>MCP 가이드: <a href="/mcp" className="hover:text-[var(--fg)]">/mcp</a></span>
        <span>·</span>
        <span>모스랜드 IR: <a href="https://disclosure.moss.land/" className="hover:text-[var(--fg)]">disclosure.moss.land</a></span>
      </footer>
    </main>
  );
}
