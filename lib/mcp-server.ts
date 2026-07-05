/**
 * MCP (Model Context Protocol) 서버 — JSON-RPC 2.0 over HTTP.
 *
 * 노출된 tools가 Claude Desktop / Cursor / Continue 등의 MCP 클라이언트에서
 * 호출 가능. 사용자는 mcp config에 alpha.moss.land/api/mcp 등록.
 *
 * 사양: https://modelcontextprotocol.io/specification
 * Transport: Streamable HTTP (JSON over POST, no SSE)
 */

import {
  getAllEntities,
  getAllTopics,
  getAllEvents,
  getEntity,
  getTopic,
  getEvent,
  getActivePulses,
  stanceDistribution,
  getVideosForEntity,
  getVideosForTopic,
  getVideosForEvent,
  type Entity,
  type Topic,
  type EventItem,
} from "./mic";
import { getSynthesis } from "./synthesis";
import { getConnectionsForEntity } from "./connections";
import { getBriefSummary } from "./brief";
import { askAlpha, getCachedAnswer } from "./ask";
import {
  checkRateLimit,
  rateLimitResponse,
  addCost,
  RL_MCP_ASK,
} from "./rate-limit";
import { search } from "./search";
import { MACRO_SERIES, getLatestObservation } from "./fred";
import { KR_MACRO_SERIES } from "./ecos";
import { AGENTS } from "./agents";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "alpha-by-mossland",
  // Matches the version published to the MCP Registry (land.moss/alpha-mcp).
  version: "1.0.0",
};

// ─── Tool definitions ─────────────────────────────────────────────

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

type ToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string; default?: unknown }>;
    required?: string[];
  };
  handler: ToolHandler;
};

function fullEntityView(e: Entity): Record<string, unknown> {
  const synth = getSynthesis("entity", e.id);
  const videos = getVideosForEntity(e.id, 5);
  const dist = stanceDistribution(videos);
  return {
    id: e.id,
    label: e.label,
    aliases: e.aliases,
    type: e.type,
    videoCount: e.videoCount,
    updatedAt: e.updatedAt,
    url:
      e.type === "asset"
        ? `https://alpha.moss.land/asset/${e.id}`
        : `https://alpha.moss.land/entity/${encodeURIComponent(e.id)}`,
    stanceDistribution: dist,
    synthesis: synth || null,
  };
}

function fullTopicView(t: Topic): Record<string, unknown> {
  const synth = getSynthesis("topic", t.id);
  const videos = getVideosForTopic(t.id, 5);
  const dist = stanceDistribution(videos);
  return {
    id: t.id,
    label: t.label,
    aliases: t.aliases,
    description: t.description,
    videoCount: t.videoCount,
    updatedAt: t.updatedAt,
    url: `https://alpha.moss.land/topic/${encodeURIComponent(t.id)}`,
    stanceDistribution: dist,
    synthesis: synth || null,
  };
}

function fullEventView(e: EventItem): Record<string, unknown> {
  const synth = getSynthesis("event", e.id);
  const videos = getVideosForEvent(e.id, 5);
  const dist = stanceDistribution(videos);
  return {
    id: e.id,
    label: e.label,
    aliases: e.aliases,
    dateHint: e.dateHint,
    relatedEntityIds: e.relatedEntityIds,
    videoCount: e.videoCount,
    updatedAt: e.updatedAt,
    url: `https://alpha.moss.land/event/${encodeURIComponent(e.id)}`,
    stanceDistribution: dist,
    synthesis: synth || null,
  };
}

const TOOLS: ToolDef[] = [
  {
    name: "search_alpha",
    description:
      "Alpha의 entity·topic·event·creator 검색. 한국 크립토·매크로·정치·국제정세 관련 키워드로 검색.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "검색어 (한글/영문 모두 가능)" },
        limit: { type: "number", description: "최대 결과 수 (기본 10)", default: 10 },
      },
      required: ["query"],
    },
    handler: async (input) => {
      const q = String(input.query || "");
      const limit = Math.min(50, Number(input.limit ?? 10));
      const hits = search(q, limit);
      return {
        query: q,
        count: hits.length,
        results: hits.map((h) => ({
          kind: h.kind,
          id: h.kind === "creator" ? h.item.youtube_channel_id : h.item.id,
          label: h.kind === "creator" ? h.item.name : h.item.label,
          url: `https://alpha.moss.land${h.href}`,
          score: h.score,
        })),
      };
    },
  },
  {
    name: "get_entity",
    description:
      "Entity 상세 — stance 분포 + AI 합성 카드 + 관련 영상 5편. ID는 search_alpha로 먼저 찾을 것.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "entity ID (e.g., 'bitcoin', 'lee-jae-myung')" } },
      required: ["id"],
    },
    handler: async (input) => {
      const e = getEntity(String(input.id || ""));
      if (!e) return { error: "entity_not_found", id: input.id };
      return fullEntityView(e);
    },
  },
  {
    name: "get_topic",
    description: "Topic 상세 — 설명 + AI 합성 + stance 분포 + 관련 영상.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: async (input) => {
      const t = getTopic(String(input.id || ""));
      if (!t) return { error: "topic_not_found", id: input.id };
      return fullTopicView(t);
    },
  },
  {
    name: "get_event",
    description: "Event 상세 — 사건 정리 + AI 합성 + 연결된 엔티티.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: async (input) => {
      const e = getEvent(String(input.id || ""));
      if (!e) return { error: "event_not_found", id: input.id };
      return fullEventView(e);
    },
  },
  {
    name: "get_macro_snapshot",
    description:
      "현재 US + KR 매크로 데이터 (Fed Funds, BoK 기준금리, 미 10Y, 한국 국고채 3년, 원/달러 등).",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const all = [
        ...MACRO_SERIES.map((s) => ({ ...s, region: "US" })),
        ...KR_MACRO_SERIES.map((s) => ({ ...s, region: "KR" })),
      ];
      return {
        generated_at: new Date().toISOString(),
        series: all
          .map((s) => {
            const obs = getLatestObservation(s.id);
            if (!obs) return null;
            return {
              id: s.id,
              region: s.region,
              label: s.label,
              labelEn: s.labelEn,
              unit: s.unit,
              latest_value: obs.value,
              latest_date: obs.date,
              description: s.description,
            };
          })
          .filter(Boolean),
      };
    },
  },
  {
    name: "get_active_pulses",
    description: "최근 N시간 내 활성 가격 시그널 (BTC/ETH 등 5분 윈도우 ≥1% 변동).",
    inputSchema: {
      type: "object",
      properties: {
        hours: {
          type: "number",
          description: "조회 윈도우 (기본 24)",
          default: 24,
        },
      },
    },
    handler: async (input) => {
      const hours = Math.min(168, Math.max(1, Number(input.hours ?? 24)));
      const pulses = getActivePulses(hours);
      return {
        window_hours: hours,
        count: pulses.length,
        pulses: pulses.slice(0, 10).map((p) => ({
          id: p.id,
          asset: p.asset,
          direction: p.direction,
          magnitudePct: p.magnitudePct,
          detectedAt: p.detectedAt,
          summary: p.summary,
          synthesisState: p.synthesisState,
          url: `https://alpha.moss.land/pulse/${p.id}`,
        })),
      };
    },
  },
  {
    name: "get_today_brief",
    description:
      "어제 또는 특정 날짜의 한국 시장 일일 브리프 (AI 합성 — oneLine + why + 5 points + quotes).",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "YYYY-MM-DD 형식. 미입력 시 어제.",
        },
      },
    },
    handler: async (input) => {
      let date = String(input.date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const t = new Date(Date.now() - 24 * 3600_000);
        date = t.toISOString().slice(0, 10);
      }
      const brief = getBriefSummary(date);
      if (!brief) return { error: "brief_not_found", date };
      return {
        ...brief,
        url: `https://alpha.moss.land/brief/${date}`,
      };
    },
  },
  {
    name: "get_connections",
    description:
      "Entity의 다른 entity와의 인과 가설 (AI 합성 — '~연관 가능성'). 8개 정렬.",
    inputSchema: {
      type: "object",
      properties: { entity_id: { type: "string" } },
      required: ["entity_id"],
    },
    handler: async (input) => {
      const id = String(input.entity_id || "");
      const conns = getConnectionsForEntity(id, 12);
      return {
        entity_id: id,
        count: conns.length,
        connections: conns.map((c) => ({
          other_entity: c.entityA === id ? c.entityB : c.entityA,
          hypothesis: c.hypothesis,
          relation_type: c.relationType,
          confidence: c.confidence,
          co_mention_count: c.coMentionCount,
        })),
      };
    },
  },
  {
    name: "ask_alpha",
    description:
      "자연어 질문 → Alpha의 데이터 RAG 답변 + 인용. 답변 ≤ 300자. 컨텍스트에 없으면 솔직히 답변.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "한국어/영문 자연어 질문 (5-500자)",
        },
      },
      required: ["question"],
    },
    handler: async (input) => {
      const q = String(input.question || "");
      const r = await askAlpha(q);
      return {
        question: r.question,
        answer: r.answer,
        citations: r.citations.map((c) => ({
          ...c,
          url: c.url.startsWith("http")
            ? c.url
            : `https://alpha.moss.land${c.url}`,
        })),
        permanent_url: `https://alpha.moss.land/ask/q/${r.questionHash}`,
        cached: r.cached,
        costUsd: r.costUsd,
      };
    },
  },
  {
    name: "list_topics",
    description: "Alpha의 모든 canonical topic 목록.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const ts = getAllTopics();
      return {
        count: ts.length,
        topics: ts.map((t) => ({
          id: t.id,
          label: t.label,
          videoCount: t.videoCount,
          url: `https://alpha.moss.land/topic/${encodeURIComponent(t.id)}`,
        })),
      };
    },
  },
  {
    name: "list_events",
    description: "Alpha의 모든 canonical event 목록.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const evs = getAllEvents();
      return {
        count: evs.length,
        events: evs.map((e) => ({
          id: e.id,
          label: e.label,
          videoCount: e.videoCount,
          dateHint: e.dateHint,
          url: `https://alpha.moss.land/event/${encodeURIComponent(e.id)}`,
        })),
      };
    },
  },
  {
    name: "list_personas",
    description:
      "Alpha의 AI 페르소나 8명 카탈로그 (커뮤니티 활동 중). 합성 캐릭터 — 1:1 실명 모방 X.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => ({
      count: AGENTS.length,
      personas: AGENTS.map((a) => ({
        handle: a.handle,
        displayName: a.displayName,
        stanceLean: a.stanceLean,
        active: a.active,
      })),
      disclosure:
        "All personas are synthetic composites of 5+ public-figure clusters. Not 1:1 impersonation. Each persona post is labeled with α glyph and 'AI persona by Alpha' footer.",
    }),
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ─── JSON-RPC handler ─────────────────────────────────────────────

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string; data?: unknown };
    };

export type McpContext = {
  /** Underlying HTTP request, when invoked over the JSON-RPC HTTP transport.
   *  Used by paid-API tools (ask_alpha) for per-IP rate limiting. */
  httpReq?: Request;
};

async function handleMethod(req: JsonRpcRequest, ctx: McpContext): Promise<unknown> {
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
      };

    case "notifications/initialized":
      return null; // no response for notifications

    case "tools/list":
      return {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };

    case "tools/call": {
      const params = req.params || {};
      const name = String(params.name);
      const args = (params.arguments as Record<string, unknown>) || {};
      const tool = TOOL_BY_NAME.get(name);
      if (!tool) {
        throw {
          code: -32602,
          message: `Unknown tool: ${name}`,
        };
      }

      // Paid-API tools: enforce per-IP + global cost ceiling.
      // Cached answers are free (handler returns cached === true) — only
      // gate fresh calls so legitimate clients with repeated queries
      // aren't penalized.
      if (name === "ask_alpha" && ctx.httpReq) {
        const q = String(args.question ?? "");
        const cached = q.length >= 5 ? getCachedAnswer(q) : null;
        if (!cached) {
          const verdict = checkRateLimit(ctx.httpReq, RL_MCP_ASK);
          if (!verdict.ok) {
            throw {
              code: -32099,
              message: `rate_limited: ${verdict.reason}`,
              data: { retry_after_sec: verdict.retryAfterSec },
            };
          }
        }
      }

      const result = await tool.handler(args);

      // Track LLM cost on fresh ask_alpha calls.
      if (name === "ask_alpha") {
        const r = result as { cached?: boolean; costUsd?: number } | undefined;
        if (r && r.cached === false && typeof r.costUsd === "number") {
          addCost(r.costUsd);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    case "ping":
      return {};

    default:
      throw {
        code: -32601,
        message: `Method not found: ${req.method}`,
      };
  }
}

export async function processMcpRequest(
  req: JsonRpcRequest,
  ctx: McpContext = {}
): Promise<JsonRpcResponse | null> {
  // notifications: no response
  if (req.id === undefined || req.id === null) {
    if (req.method === "notifications/initialized") return null;
    // notifications without id → no response
    return null;
  }
  try {
    const result = await handleMethod(req, ctx);
    return { jsonrpc: "2.0", id: req.id, result };
  } catch (err) {
    const errorObj = err as { code?: number; message?: string; data?: unknown };
    if (errorObj.code && errorObj.message) {
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: errorObj as { code: number; message: string; data?: unknown },
      };
    }
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: -32603,
        message: "Internal error",
        data: (err as Error).message,
      },
    };
  }
}

export function listToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

export function listToolsPublic() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}
