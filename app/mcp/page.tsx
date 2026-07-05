import { listToolsPublic } from "@/lib/mcp-server";
import { registerSeoPage } from "@/lib/seo-register";
import { SITE } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-static";
export const revalidate = 86400;

export const metadata: Metadata = {
  title: "MCP Server — Alpha by Mossland",
  description:
    "Claude Desktop · Cursor · Continue 등 MCP 클라이언트에서 Alpha의 한국 크립토·매크로 데이터를 도구로 사용. 12개 tools 노출.",
  alternates: { canonical: `${SITE.baseUrl}/mcp` },
};

export default function McpDocPage() {
  const tools = listToolsPublic();

  registerSeoPage({
    path: "/mcp",
    page_type: "agent",
    title: "MCP Server — Alpha",
    meta_description: "Claude/Cursor에서 Alpha 데이터를 도구로 사용",
    quality_score: 0.7,
  });

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-[var(--muted)] mb-4">
        <a href="/" className="hover:underline">α Alpha</a>
        <span className="mx-2">/</span>
        <span>MCP</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
          MCP Server
        </h1>
        <p className="text-base leading-relaxed text-zinc-700">
          Claude Desktop · Cursor · Continue 등 <strong>MCP 클라이언트</strong>에서
          Alpha의 한국 크립토·매크로 데이터를 도구로 사용하세요. 모든 라이브 데이터
          (entity 141 · topic 22 · event 31 · 페르소나 발화 · macro 11 series)에
          접근 가능.
        </p>
        <p className="mt-3 text-xs text-[var(--muted)]">
          엔드포인트: <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded">https://alpha.moss.land/api/mcp</code>{" "}
          · Transport: Streamable HTTP · Protocol: 2025-06-18
        </p>
      </header>

      {/* 빠른 시작 */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          빠른 시작 — Claude Desktop
        </h2>
        <p className="text-sm mb-3">
          <code className="font-mono bg-zinc-100 px-1.5 py-0.5 rounded">~/Library/Application Support/Claude/claude_desktop_config.json</code>{" "}
          에 추가:
        </p>
        <pre className="rounded-2xl bg-zinc-900 text-zinc-100 p-4 text-xs overflow-x-auto">
{`{
  "mcpServers": {
    "alpha": {
      "url": "https://alpha.moss.land/api/mcp"
    }
  }
}`}
        </pre>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Claude Desktop을 재시작하면 도구 목록에 alpha가 나타납니다.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          Cursor
        </h2>
        <p className="text-sm mb-3">
          <code className="font-mono bg-zinc-100 px-1.5 py-0.5 rounded">.cursor/mcp.json</code> 또는 Cursor 설정의 MCP에 추가:
        </p>
        <pre className="rounded-2xl bg-zinc-900 text-zinc-100 p-4 text-xs overflow-x-auto">
{`{
  "mcpServers": {
    "alpha": {
      "url": "https://alpha.moss.land/api/mcp",
      "type": "http"
    }
  }
}`}
        </pre>
      </section>

      {/* curl 테스트 */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          curl 테스트
        </h2>
        <pre className="rounded-2xl bg-zinc-900 text-zinc-100 p-4 text-xs overflow-x-auto">
{`# 1. initialize
curl -X POST https://alpha.moss.land/api/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

# 2. tools/list
curl -X POST https://alpha.moss.land/api/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. tools/call (예: search_alpha)
curl -X POST https://alpha.moss.land/api/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_alpha","arguments":{"query":"비트코인"}}}'`}
        </pre>
      </section>

      {/* Tool 목록 */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          노출된 도구 ({tools.length}개)
        </h2>
        <ul className="space-y-3">
          {tools.map((t) => (
            <li
              key={t.name}
              className="rounded-2xl border border-[var(--line)] bg-white p-4"
            >
              <div className="flex items-baseline gap-2 mb-1.5">
                <code className="font-mono text-sm text-[var(--moss)]">
                  {t.name}
                </code>
                <span className="text-[10px] text-[var(--muted)]">
                  {Object.keys(t.inputSchema.properties).length}개 인자
                </span>
              </div>
              <p className="text-sm text-zinc-700 leading-relaxed">
                {t.description}
              </p>
              {Object.keys(t.inputSchema.properties).length > 0 && (
                <details className="mt-2 text-xs text-[var(--muted)]">
                  <summary className="cursor-pointer hover:text-[var(--fg)]">
                    인자 보기
                  </summary>
                  <pre className="mt-2 bg-zinc-50 p-2 rounded text-[10px] overflow-x-auto">
                    {JSON.stringify(t.inputSchema, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 사용 예시 */}
      <section className="mb-10">
        <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
          MCP 클라이언트에서 자연스러운 사용
        </h2>
        <ul className="space-y-2 text-sm">
          <li>
            <strong>Claude Desktop:</strong> "Alpha의 도구로 한국 매크로 현재
            상황을 알려줘" → Claude가 자동으로 <code>get_macro_snapshot</code>{" "}
            호출
          </li>
          <li>
            <strong>Cursor:</strong> 코드 리뷰 중 "BTC 관련 한국 채널 시각이
            어떻게 갈리지?" → <code>get_entity</code> + <code>get_connections</code>
          </li>
          <li>
            <strong>Continue:</strong> 자료조사 시 "이재명 대통령 관련 최근
            이벤트" → <code>search_alpha</code> + <code>get_today_brief</code>
          </li>
        </ul>
      </section>

      <footer className="mt-12 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>운영: Mossland</span>
        <span className="mx-2">·</span>
        <span>인증: 무료 read-only (rate limit 미적용 — 향후 변경 가능)</span>
        <span className="mx-2">·</span>
        <span>스펙: <a href="https://modelcontextprotocol.io" className="hover:text-[var(--fg)]">modelcontextprotocol.io</a></span>
      </footer>
    </main>
  );
}
