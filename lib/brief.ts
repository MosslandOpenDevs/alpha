/**
 * Daily brief AI 요약 — /brief/[date] 페이지 상단 자동 5-블록 카드.
 *
 * 입력: 그날 갱신된 entity·topic·event + 그날의 pulse + 합성 카드
 * 출력: oneLine + why + points[5] + quotes
 *
 * 캐시: alpha_brief_summaries 테이블 (날짜별 1개).
 * 갱신: 매일 cron — 어제 자료까지 정리.
 */

import { getDb } from "./db";
import { chat } from "./grok";
import {
  getAllEntities,
  getAllTopics,
  getAllEvents,
  getAllPulses,
  type Entity,
  type Topic,
  type EventItem,
  type Pulse,
} from "./mic";
import { getSynthesis } from "./synthesis";

const PROMPT_VERSION = "brief-v2";

export type BriefSummary = {
  date: string;
  oneLine: string;
  why: string;
  points: string[];
  quotes: { text: string; source: string }[];
  generatedAt: string;
};

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_brief_summaries (
      date TEXT PRIMARY KEY,
      one_line TEXT NOT NULL,
      why TEXT,
      points TEXT,
      quotes TEXT,
      generated_at TEXT NOT NULL,
      cost_usd REAL
    );
  `);
}

export function getBriefSummary(date: string): BriefSummary | null {
  ensureTable();
  const row = getDb()
    .prepare(`SELECT * FROM alpha_brief_summaries WHERE date = ?`)
    .get(date) as
    | {
        date: string;
        one_line: string;
        why: string | null;
        points: string | null;
        quotes: string | null;
        generated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    date: row.date,
    oneLine: row.one_line,
    why: row.why || "",
    points: row.points ? JSON.parse(row.points) : [],
    quotes: row.quotes ? JSON.parse(row.quotes) : [],
    generatedAt: row.generated_at,
  };
}

/** Bounds for the given calendar date interpreted as KST (Asia/Seoul, UTC+9).
 *  KST midnight 00:00 corresponds to UTC 15:00 of the previous day. */
function dayBounds(date: string): { start: number; end: number } {
  const KST_OFFSET_MS = 9 * 3600_000;
  const start = Date.parse(date + "T00:00:00Z") - KST_OFFSET_MS;
  const end = start + 24 * 3600_000;
  return { start, end };
}

export async function generateBriefSummary(
  date: string
): Promise<{ summary: BriefSummary; cacheHit: boolean; costUsd: number }> {
  ensureTable();

  const { start, end } = dayBounds(date);
  const updatedToday = (iso: string) => {
    const t = Date.parse(iso);
    return t >= start && t < end;
  };

  // Pulses are the only signal with reliable per-row timestamps —
  // signalmap stamps entity/topic/event updatedAt to its regeneration
  // time, so per-day filtering on those collapses to "latest regen day"
  // and is empty on every other day. Use them as supporting context
  // (top by video count) instead of strict same-day filter.
  const pulses: Pulse[] = getAllPulses().filter((p) => {
    const t = Date.parse(p.detectedAt);
    return t >= start && t < end;
  });

  const todayEntities = getAllEntities().filter((e) => updatedToday(e.updatedAt));
  const todayTopics = getAllTopics().filter((t) => updatedToday(t.updatedAt));
  const todayEvents = getAllEvents().filter((e) => updatedToday(e.updatedAt));

  // If signalmap regenerated on this day, prefer the per-day filter.
  // Otherwise fall back to the latest top-N snapshot so we still get a
  // meaningful brief for days when signalmap didn't regenerate.
  const entitiesPool = todayEntities.length > 0 ? todayEntities : getAllEntities();
  const topicsPool = todayTopics.length > 0 ? todayTopics : getAllTopics();
  const eventsPool = todayEvents.length > 0 ? todayEvents : getAllEvents();

  const entities: Entity[] = entitiesPool
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 12);
  const topics: Topic[] = topicsPool
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 8);
  const events: EventItem[] = eventsPool
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 6);

  if (entities.length + topics.length + events.length + pulses.length === 0) {
    throw new Error(`No data for ${date}`);
  }

  const entitySynthLines = entities
    .slice(0, 8)
    .map((e) => {
      const s = getSynthesis("entity", e.id);
      return s ? `- [${e.label}] ${s.oneLine}` : `- [${e.label}] (영상 ${e.videoCount}편)`;
    })
    .join("\n");
  const topicLines = topics.map((t) => `- ${t.label}`).join("\n");
  const eventLines = events.map((e) => `- ${e.label}`).join("\n");
  const pulseLines = pulses
    .slice(0, 4)
    .map((p) => {
      const dirSign = p.direction === "up" ? "+" : "-";
      return `- ${p.assetLabel || p.asset} ${dirSign}${Math.abs(p.magnitudePct).toFixed(2)}% — ${p.summary.slice(0, 80)}`;
    })
    .join("\n");

  const prompt = `${date} 한국 시장 일일 브리프 정리.

오늘 갱신된 엔티티 (${entities.length}):
${entitySynthLines || "(없음)"}

새 토픽 (${topics.length}):
${topicLines || "(없음)"}

새 이벤트 (${events.length}):
${eventLines || "(없음)"}

가격 시그널 (${pulses.length}):
${pulseLines || "(없음)"}

위 자료로 ${date} 한국 시장 한 컷을 5-블록으로 작성. 응답은 *오직 JSON*. markdown 백틱 X.

스키마:
{
  "oneLine": "이 날의 한국 시장 한 줄 요약 (≤80자)",
  "why": "왜 이 날이 중요한가 (≤120자)",
  "points": ["핵심 변화 1 (≤40자)", "핵심 변화 2 (≤40자)", "핵심 변화 3 (≤40자)", "다른 시각 1 (≤40자)", "내일 볼 것 (≤40자)"],
  "quotes": [{"text": "주요 인용 (≤80자)", "source": "출처"}]
}

규칙:
- 한국어 출력
- 가격 권유 X
- 정치 인물 비방 X
- 사실 + 시각 + forward-looking 균형`;

  const result = await chat(
    [
      {
        role: "system",
        content:
          "당신은 한국 크립토·매크로 미디어 큐레이터입니다. 일일 시장 브리프를 5-블록으로 정리합니다.",
      },
      { role: "user", content: prompt },
    ],
    { promptVersion: PROMPT_VERSION, maxTokens: 900, temperature: 0.3 }
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

  const summary: BriefSummary = {
    date,
    oneLine: parsed.oneLine || "",
    why: parsed.why || "",
    points: parsed.points || [],
    quotes: parsed.quotes || [],
    generatedAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT OR REPLACE INTO alpha_brief_summaries
        (date, one_line, why, points, quotes, generated_at, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      date,
      summary.oneLine,
      summary.why,
      JSON.stringify(summary.points),
      JSON.stringify(summary.quotes),
      summary.generatedAt,
      result.costUsd
    );

  return { summary, cacheHit: result.cacheHit, costUsd: result.costUsd };
}
