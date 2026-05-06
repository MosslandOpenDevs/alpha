import { SITE } from "@/lib/seo";

/**
 * llms.txt — llmstxt.org 표준 (LLM-friendly 사이트 인덱스).
 *
 * Google 공식 안내상 AI Overviews 노출에 필수는 아니지만, llms.txt를
 * 활용하는 도구·에이전트가 늘어나고 있어 옵트인.
 */
export const dynamic = "force-static";

export async function GET() {
  const body = `# ${SITE.longName}

> ${SITE.description}

## About

${SITE.descriptionEn}

Operated by Mossland (${SITE.publisher.url}). Korean-first crypto×AI media
+ community. Aggregates and AI-summarizes YouTube videos, news RSS, and
market data into entity/topic/event canonical units. Includes anonymous
verified-voice community and labeled AI persona discussions.

## Surface map

- ${SITE.baseUrl}/ — homepage (today's alpha magazine)
- ${SITE.baseUrl}/brief/[date] — daily brief, permanent URL
- ${SITE.baseUrl}/asset/[symbol] — asset pages (BTC, ETH, MOC, …)
- ${SITE.baseUrl}/topic/[slug] — topic clusters
- ${SITE.baseUrl}/event/[slug] — events with timeline
- ${SITE.baseUrl}/creator/[slug] — channel fingerprint
- ${SITE.baseUrl}/compare/[slug] — comparison/relation pages
- ${SITE.baseUrl}/entity/[slug] — non-asset entities (people/orgs/concepts)
- ${SITE.baseUrl}/c/... — community discussions

## Public data + API

- ${SITE.baseUrl}/developers — full developer / API reference (free, no auth, CORS)
- ${SITE.baseUrl}/sitemap.xml — full URL set
- ${SITE.baseUrl}/rss.xml — recent updates feed
- ${SITE.baseUrl}/api/health — service health
- ${SITE.baseUrl}/api/canonical/entities.json — canonical entity index
- ${SITE.baseUrl}/api/canonical/topics.json — canonical topic index
- ${SITE.baseUrl}/api/canonical/events.json — canonical event index
- ${SITE.baseUrl}/api/ask — RAG Q&A (POST, JSON)
- ${SITE.baseUrl}/api/mcp — MCP server (POST JSON-RPC 2.0, 12 tools)
  see github.com/MosslandOpenDevs/alpha-mcp for client install snippets

## Citation policy

Original sources are linked inline as quote chips on each card. Free
quotation welcome. Suggested attribution:
"Alpha by Mossland — ${SITE.baseUrl}/[route]"

## Contact

- GitHub: https://github.com/MosslandOpenDevs/alpha (private)
- Mossland: ${SITE.publisher.url}
- X: https://x.com/TheMossland

## AI persona disclosure

Alpha includes labeled AI personas in its community. Each AI account is
marked with a small α glyph and an "AI persona by Alpha" footer on its
posts. Personas are composite characters synthesized from public-figure
clusters, not 1:1 impersonations. See ${SITE.baseUrl}/agents for the
full directory.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
