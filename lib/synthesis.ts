/**
 * AI synthesis — 하나의 entity/topic/event에 대한 여러 영상을 합성해
 * Smart Brevity 5-블록 카드 1개 생성.
 *
 * 캐시: alpha_synthesis 테이블 + ai_runs 캐시 (sha256 입력 해시).
 * 입력이 동일 (영상 set 변화 없음) → Grok 호출 0회.
 *
 * 비용: 영상 10개 합성 1회 ~$0.001. 일 1회 갱신 시 월 $0.30.
 */

import { getDb } from "./db";
import { chat } from "./grok";
import {
  getEntity,
  getTopic,
  getEvent,
  getVideosForEntity,
  getVideosForTopic,
  getVideosForEvent,
  type VideoRecord,
} from "./mic";

const PROMPT_VERSION = "synth-v1";

export type SynthesisRow = {
  id: string;
  ref_type: "entity" | "topic" | "event";
  ref_id: string;
  one_line: string;
  why: string;
  points: string; // JSON string of string[]
  quotes: string; // JSON string of {text, source}[]
  generated_at: string;
  cost_usd: number;
  cache_hit: number;
};

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_synthesis (
      id TEXT PRIMARY KEY,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      one_line TEXT NOT NULL,
      why TEXT,
      points TEXT,
      quotes TEXT,
      generated_at TEXT NOT NULL,
      cost_usd REAL,
      cache_hit INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_alpha_synthesis_ref
      ON alpha_synthesis(ref_type, ref_id);
  `);
}

export type Synthesis = {
  oneLine: string;
  why: string;
  points: string[];
  quotes: { text: string; source: string }[];
  generatedAt: string;
};

export function getSynthesis(
  refType: "entity" | "topic" | "event",
  refId: string
): Synthesis | null {
  ensureTable();
  const row = getDb()
    .prepare(
      `SELECT * FROM alpha_synthesis WHERE ref_type = ? AND ref_id = ?
       ORDER BY generated_at DESC LIMIT 1`
    )
    .get(refType, refId) as SynthesisRow | undefined;
  if (!row) return null;
  return {
    oneLine: row.one_line,
    why: row.why || "",
    points: row.points ? JSON.parse(row.points) : [],
    quotes: row.quotes ? JSON.parse(row.quotes) : [],
    generatedAt: row.generated_at,
  };
}

function buildPrompt(args: {
  refType: string;
  refLabel: string;
  videos: VideoRecord[];
}): string {
  const { refType, refLabel, videos } = args;
  const videoLines = videos
    .slice(0, 10)
    .map((v, i) => {
      const stance = v.analysis?.stance ?? "neutral";
      const summary = v.analysis?.summary_oneline ?? "";
      const author = v.meta.author_name ?? "unknown";
      return `${i + 1}. [${stance}] (${author}) ${summary}`;
    })
    .join("\n");
  const quoteLines = videos
    .slice(0, 6)
    .flatMap((v) => v.analysis?.quotes?.[0]?.text ? [`"${v.analysis.quotes[0].text}" — ${v.meta.author_name ?? ""}`] : [])
    .slice(0, 5)
    .join("\n");

  return `당신은 한국 크립토·매크로 미디어 큐레이터입니다.
다음은 ${refType} "${refLabel}" 에 대해 한국 채널들이 다룬 ${videos.length}개 영상의 요약입니다.

영상 요약:
${videoLines}

대표 인용:
${quoteLines}

위 정보로 5-블록 합성 카드를 JSON 형식으로 작성해주세요. 응답은 *오직 JSON*. markdown 백틱 X.

스키마:
{
  "oneLine": "한 줄 요약 (≤80자, 사실 + 인사이트)",
  "why": "왜 중요한가 (≤120자)",
  "points": ["확인된 사실 (≤40자)", "가능한 원인 (≤40자)", "다른 해석 (≤40자)", "연결된 자산/토픽 (≤40자)", "아직 불확실한 것 (≤40자)"],
  "quotes": [{"text": "원본 인용 (≤80자)", "source": "채널명"}]
}

규칙:
- ≤ 80자 / ≤ 120자 / ≤ 40자 한도 *반드시* 준수
- 가격 권유·매수/매도 추천 X
- 정치 인물 이름 H1에 X (이슈명만)
- 한국어 출력
- 출처 직접 인용은 quotes에만`;
}

export async function generateSynthesis(
  refType: "entity" | "topic" | "event",
  refId: string,
  opts: { force?: boolean } = {}
): Promise<{
  synthesis: Synthesis;
  cacheHit: boolean;
  costUsd: number;
}> {
  ensureTable();

  let videos: VideoRecord[] = [];
  let label: string | null = null;
  if (refType === "entity") {
    const e = getEntity(refId);
    if (e) {
      label = e.label;
      videos = getVideosForEntity(refId, 12);
    }
  } else if (refType === "topic") {
    const t = getTopic(refId);
    if (t) {
      label = t.label;
      videos = getVideosForTopic(refId, 12);
    }
  } else if (refType === "event") {
    const ev = getEvent(refId);
    if (ev) {
      label = ev.label;
      videos = getVideosForEvent(refId, 12);
    }
  }

  if (!label || videos.length === 0) {
    throw new Error(`No data for ${refType}:${refId}`);
  }

  const prompt = buildPrompt({ refType, refLabel: label, videos });
  const result = await chat(
    [
      { role: "system", content: "당신은 한국 미디어 큐레이터입니다. 사실 + 다중 시각 + 출처 직링크가 핵심입니다." },
      { role: "user", content: prompt },
    ],
    { promptVersion: PROMPT_VERSION, maxTokens: 600, temperature: 0.3 }
  );

  let parsed: {
    oneLine: string;
    why: string;
    points: string[];
    quotes: { text: string; source: string }[];
  };
  try {
    const json = result.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid JSON from Grok: ${result.content.slice(0, 200)}`);
  }

  const synthesis: Synthesis = {
    oneLine: parsed.oneLine || "",
    why: parsed.why || "",
    points: parsed.points || [],
    quotes: parsed.quotes || [],
    generatedAt: new Date().toISOString(),
  };

  // Persist
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO alpha_synthesis
        (id, ref_type, ref_id, one_line, why, points, quotes,
         generated_at, cost_usd, cache_hit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `${refType}:${refId}`,
      refType,
      refId,
      synthesis.oneLine,
      synthesis.why,
      JSON.stringify(synthesis.points),
      JSON.stringify(synthesis.quotes),
      synthesis.generatedAt,
      result.costUsd,
      result.cacheHit ? 1 : 0
    );

  return { synthesis, cacheHit: result.cacheHit, costUsd: result.costUsd };
}
