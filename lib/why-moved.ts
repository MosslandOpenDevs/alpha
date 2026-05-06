/**
 * /asset/[symbol]/why-moved/[date] 페이지 생성기.
 *
 * 입력: asset 자산 + 날짜 → pulse + 그날의 entity/topic synthesis + sources
 * 출력: Smart Brevity 답변 형 article ("오늘 BTC 왜 움직였나")
 *
 * SEO 직격 ("오늘 비트코인 왜?" 류 audit Q1-Q5).
 * 캐시: alpha_why_moved 테이블 — 한 번 생성하면 영구.
 *
 * 비용: ~$0.0005/article (Grok Smart Brevity).
 */

import { getDb } from "./db";
import { chat } from "./grok";
import { getAllPulses, getEntity, type Pulse } from "./mic";

const PROMPT_VERSION = "why-moved-v1";

export type WhyMovedArticle = {
  asset: string;
  date: string;
  title: string;
  oneLine: string;
  why: string;
  points: string[];          // 5 point Smart Brevity
  pulses: Pulse[];           // 그날의 pulse
  sources: { url: string; title?: string; publisher?: string }[];
  generatedAt: string;
};

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_why_moved (
      asset TEXT NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      one_line TEXT NOT NULL,
      why TEXT,
      points TEXT NOT NULL,
      pulses TEXT NOT NULL,
      sources TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      cost_usd REAL,
      PRIMARY KEY (asset, date)
    );
    CREATE INDEX IF NOT EXISTS idx_why_moved_date
      ON alpha_why_moved(date DESC);
  `);
}

export function getWhyMoved(asset: string, date: string): WhyMovedArticle | null {
  ensureTable();
  const row = getDb()
    .prepare(
      `SELECT * FROM alpha_why_moved WHERE asset = ? AND date = ?`
    )
    .get(asset.toLowerCase(), date) as
    | {
        asset: string;
        date: string;
        title: string;
        one_line: string;
        why: string | null;
        points: string;
        pulses: string;
        sources: string;
        generated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    asset: row.asset,
    date: row.date,
    title: row.title,
    oneLine: row.one_line,
    why: row.why || "",
    points: JSON.parse(row.points),
    pulses: JSON.parse(row.pulses) as Pulse[],
    sources: JSON.parse(row.sources),
    generatedAt: row.generated_at,
  };
}

export function listWhyMovedForAsset(asset: string, limit = 10): WhyMovedArticle[] {
  ensureTable();
  const rows = getDb()
    .prepare(
      `SELECT * FROM alpha_why_moved WHERE asset = ?
       ORDER BY date DESC LIMIT ?`
    )
    .all(asset.toLowerCase(), limit) as Array<{
    asset: string;
    date: string;
    title: string;
    one_line: string;
    why: string | null;
    points: string;
    pulses: string;
    sources: string;
    generated_at: string;
  }>;
  return rows.map((row) => ({
    asset: row.asset,
    date: row.date,
    title: row.title,
    oneLine: row.one_line,
    why: row.why || "",
    points: JSON.parse(row.points),
    pulses: JSON.parse(row.pulses) as Pulse[],
    sources: JSON.parse(row.sources),
    generatedAt: row.generated_at,
  }));
}

export function listRecentWhyMoved(limit = 30): WhyMovedArticle[] {
  ensureTable();
  const rows = getDb()
    .prepare(
      `SELECT * FROM alpha_why_moved
       ORDER BY date DESC LIMIT ?`
    )
    .all(limit) as Array<{
    asset: string;
    date: string;
    title: string;
    one_line: string;
    why: string | null;
    points: string;
    pulses: string;
    sources: string;
    generated_at: string;
  }>;
  return rows.map((row) => ({
    asset: row.asset,
    date: row.date,
    title: row.title,
    oneLine: row.one_line,
    why: row.why || "",
    points: JSON.parse(row.points),
    pulses: JSON.parse(row.pulses) as Pulse[],
    sources: JSON.parse(row.sources),
    generatedAt: row.generated_at,
  }));
}

function dayBounds(date: string): { start: number; end: number } {
  const start = Date.parse(date + "T00:00:00Z");
  const end = start + 24 * 3600_000;
  return { start, end };
}

export async function generateWhyMoved(
  asset: string,
  date: string
): Promise<WhyMovedArticle | null> {
  ensureTable();
  asset = asset.toLowerCase();

  // pulse 찾기
  const { start, end } = dayBounds(date);
  const pulses = getAllPulses().filter((p) => {
    const t = Date.parse(p.detectedAt);
    return t >= start && t < end && p.asset.toLowerCase() === asset;
  });
  if (pulses.length === 0) {
    // 이 날 해당 자산에 pulse 없으면 article 생성 X
    return null;
  }

  // entity label
  const entity = getEntity(asset);
  const assetLabel = entity?.label || asset.toUpperCase();

  // sources 통합 (모든 pulse에서)
  const allSources = pulses.flatMap((p) => p.sources || []);
  const uniqueSources = [
    ...new Map(allSources.map((s) => [s.url, s])).values(),
  ].slice(0, 8);

  const pulseLines = pulses
    .map((p) => {
      const dirSign = p.direction === "up" ? "+" : "-";
      const t = new Date(p.detectedAt);
      const timeStr = t.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Seoul",
      });
      return `- ${timeStr} KST: ${dirSign}${Math.abs(p.magnitudePct).toFixed(2)}% (${p.priceFrom?.toLocaleString()} → ${p.priceTo?.toLocaleString()}) — ${p.summary.slice(0, 200)}`;
    })
    .join("\n");

  const sourceLines = uniqueSources
    .map((s) => `- ${s.title || s.url} (${s.publisher || "source"})`)
    .join("\n");

  const prompt = `${date} 한국 시장 시각으로 "${assetLabel}이 왜 움직였나" 정리.

== 오늘의 가격 시그널 (${pulses.length}건) ==
${pulseLines}

== 외부 보도 (${uniqueSources.length}개 출처) ==
${sourceLines}

위 자료로 한국 retail 독자에게 "오늘 ${assetLabel} 왜 움직였나" 답변 작성.
응답은 *오직 JSON*. markdown 백틱 X.

스키마:
{
  "title": "오늘 ${assetLabel}는 왜 움직였나? — ${date} (≤60자)",
  "oneLine": "한 줄 결론 (≤80자, 사실 + 인사이트)",
  "why": "왜 중요한가 (≤120자)",
  "points": [
    "확인된 사실 (≤50자)",
    "가능한 원인 (≤50자)",
    "다른 해석 (≤50자)",
    "연결된 자산/매크로 (≤50자)",
    "아직 불확실한 것 (≤50자)"
  ]
}

규칙:
- 한국어 출력
- 가격 권유 X · 정치 비방 X · 단정 X
- pulse summary와 보도 내용 *구체적*으로 인용
- generic 문구 X
- "...로 보임", "~가능성" 어휘`;

  const result = await chat(
    [
      {
        role: "system",
        content:
          "당신은 한국 크립토·매크로 미디어 큐레이터입니다. 가격 변동 원인을 사실 + 다중 시각으로 정리합니다.",
      },
      { role: "user", content: prompt },
    ],
    { promptVersion: PROMPT_VERSION, maxTokens: 700, temperature: 0.3 }
  );

  let parsed: {
    title: string;
    oneLine: string;
    why: string;
    points: string[];
  };
  try {
    const json = result.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid JSON from Grok: ${result.content.slice(0, 200)}`);
  }

  const article: WhyMovedArticle = {
    asset,
    date,
    title: parsed.title || `오늘 ${assetLabel}는 왜 움직였나? — ${date}`,
    oneLine: parsed.oneLine || "",
    why: parsed.why || "",
    points: parsed.points || [],
    pulses,
    sources: uniqueSources,
    generatedAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT OR REPLACE INTO alpha_why_moved
        (asset, date, title, one_line, why, points, pulses, sources, generated_at, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      asset,
      date,
      article.title,
      article.oneLine,
      article.why,
      JSON.stringify(article.points),
      JSON.stringify(article.pulses),
      JSON.stringify(article.sources),
      article.generatedAt,
      result.costUsd
    );

  return article;
}
