/**
 * Connection engine — entity ↔ entity 1줄 인과 가설.
 *
 * 입력: entity 두 개 + 공동 출현 영상의 요약 + 토픽
 * 출력: "X와 Y는 [관계 타입] 으로 연결됨 — [근거 1줄]" 형태
 *
 * 캐시: alpha_connections 테이블.
 * 비용: 페어당 ~$0.0001-0.0003.
 */

import { getDb } from "./db";
import { chat } from "./grok";
import {
  getEntity,
  getVideo,
  type Entity,
  type VideoRecord,
} from "./mic";

const PROMPT_VERSION = "conn-v1";

export type Connection = {
  entityA: string;
  entityB: string;
  hypothesis: string; // 1줄
  relationType: "causal" | "correlative" | "narrative" | "contradictory" | "shared-context" | string;
  confidence: "high" | "medium" | "low" | string;
  coMentionCount: number;
  generatedAt: string;
};

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_connections (
      pair_id TEXT PRIMARY KEY,
      entity_a TEXT NOT NULL,
      entity_b TEXT NOT NULL,
      hypothesis TEXT NOT NULL,
      relation_type TEXT,
      confidence TEXT,
      co_mention_count INTEGER,
      generated_at TEXT NOT NULL,
      cost_usd REAL
    );
    CREATE INDEX IF NOT EXISTS idx_alpha_connections_a
      ON alpha_connections(entity_a);
    CREATE INDEX IF NOT EXISTS idx_alpha_connections_b
      ON alpha_connections(entity_b);
  `);
}

function pairId(a: string, b: string): string {
  // 정렬해서 안정 ID
  return [a, b].sort().join("::");
}

export function getConnection(a: string, b: string): Connection | null {
  ensureTable();
  const id = pairId(a, b);
  const row = getDb()
    .prepare(
      `SELECT * FROM alpha_connections WHERE pair_id = ?`
    )
    .get(id) as
    | {
        entity_a: string;
        entity_b: string;
        hypothesis: string;
        relation_type: string | null;
        confidence: string | null;
        co_mention_count: number | null;
        generated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    entityA: row.entity_a,
    entityB: row.entity_b,
    hypothesis: row.hypothesis,
    relationType: row.relation_type || "shared-context",
    confidence: row.confidence || "medium",
    coMentionCount: row.co_mention_count || 0,
    generatedAt: row.generated_at,
  };
}

export function getConnectionsForEntity(entityId: string, limit = 8): Connection[] {
  ensureTable();
  const rows = getDb()
    .prepare(
      `SELECT * FROM alpha_connections
       WHERE entity_a = ? OR entity_b = ?
       ORDER BY co_mention_count DESC LIMIT ?`
    )
    .all(entityId, entityId, limit) as {
    entity_a: string;
    entity_b: string;
    hypothesis: string;
    relation_type: string | null;
    confidence: string | null;
    co_mention_count: number | null;
    generated_at: string;
  }[];
  return rows.map((r) => ({
    entityA: r.entity_a,
    entityB: r.entity_b,
    hypothesis: r.hypothesis,
    relationType: r.relation_type || "shared-context",
    confidence: r.confidence || "medium",
    coMentionCount: r.co_mention_count || 0,
    generatedAt: r.generated_at,
  }));
}

function buildPrompt(args: {
  entityA: Entity;
  entityB: Entity;
  sharedVideos: VideoRecord[];
}): string {
  const { entityA: a, entityB: b, sharedVideos } = args;
  const videoLines = sharedVideos
    .slice(0, 6)
    .map((v, i) => {
      const summary = v.analysis?.summary_oneline ?? "";
      return `${i + 1}. ${summary}`;
    })
    .join("\n");

  return `당신은 한국 크립토·매크로 분석가입니다.
다음 두 개체가 ${sharedVideos.length}편의 한국 채널 영상에서 함께 언급됐습니다.

A: ${a.label} (${a.type})
B: ${b.label} (${b.type})

공통 출현 영상 요약 (최대 6편):
${videoLines}

위 영상들을 근거로 A와 B의 관계를 한 줄 가설로 정리해주세요.
응답은 *오직 JSON*. markdown 백틱 X. 한국어 출력.

스키마:
{
  "hypothesis": "A와 B의 관계를 한 줄로 (≤80자, 인과·상관·맥락 중 하나)",
  "relationType": "causal | correlative | narrative | contradictory | shared-context",
  "confidence": "high | medium | low"
}

규칙:
- hypothesis는 단정하지 말 것 — "~로 보임", "~연관 가능성" 등 추정형
- 근거가 약하면 confidence=low + relationType=shared-context
- 정치 인물끼리는 비방·추측성 X, 단순 상황 정리만`;
}

export async function generateConnection(
  entityIdA: string,
  entityIdB: string
): Promise<{ connection: Connection; cacheHit: boolean; costUsd: number }> {
  ensureTable();

  const a = getEntity(entityIdA);
  const b = getEntity(entityIdB);
  if (!a || !b) throw new Error(`Entity not found: ${entityIdA} or ${entityIdB}`);

  // 공통 video set
  const sharedVideoIds = a.videoIds.filter((id) => b.videoIds.includes(id));
  if (sharedVideoIds.length === 0) {
    throw new Error("No co-mentioned videos");
  }
  const sharedVideos = sharedVideoIds
    .map((id) => getVideo(id))
    .filter((v): v is VideoRecord => !!v);

  const prompt = buildPrompt({ entityA: a, entityB: b, sharedVideos });

  const result = await chat(
    [
      {
        role: "system",
        content:
          "당신은 한국 미디어 분석가입니다. 한국 채널들이 두 개체를 함께 다룬 영상을 근거로, 두 개체의 관계를 한 줄 가설로 정리합니다.",
      },
      { role: "user", content: prompt },
    ],
    { promptVersion: PROMPT_VERSION, maxTokens: 200, temperature: 0.3 }
  );

  let parsed: { hypothesis: string; relationType: string; confidence: string };
  try {
    const json = result.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid JSON from Grok: ${result.content.slice(0, 200)}`);
  }

  const conn: Connection = {
    entityA: entityIdA,
    entityB: entityIdB,
    hypothesis: parsed.hypothesis || "",
    relationType: parsed.relationType || "shared-context",
    confidence: parsed.confidence || "medium",
    coMentionCount: sharedVideoIds.length,
    generatedAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT OR REPLACE INTO alpha_connections
        (pair_id, entity_a, entity_b, hypothesis, relation_type,
         confidence, co_mention_count, generated_at, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      pairId(entityIdA, entityIdB),
      entityIdA,
      entityIdB,
      conn.hypothesis,
      conn.relationType,
      conn.confidence,
      conn.coMentionCount,
      conn.generatedAt,
      result.costUsd
    );

  return { connection: conn, cacheHit: result.cacheHit, costUsd: result.costUsd };
}
