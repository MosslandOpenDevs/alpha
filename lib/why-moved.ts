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
import {
  formatPulseLoadDiagnostics,
  getAllPulses,
  getEntity,
  getPulseLoadDiagnostics,
  type Pulse,
} from "./mic";

const PROMPT_VERSION = "why-moved-v1";
const KST_OFFSET_MS = 9 * 3600_000;

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

export function listAllWhyMoved(): WhyMovedArticle[] {
  ensureTable();
  const rows = getDb()
    .prepare(`SELECT * FROM alpha_why_moved ORDER BY date DESC`)
    .all() as Array<{
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

/** Calendar date for an ISO timestamp as observed in Korea (UTC+9). */
export function kstDateForTimestamp(timestamp: string): string | null {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return null;
  return new Date(time + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) epoch-ms bounds of a KST calendar day. Throws on an
 *  invalid date so callers cannot silently query an empty window. */
export function kstDayBounds(date: string): { start: number; end: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  const midnightUtc = Date.parse(date + "T00:00:00Z");
  if (
    !Number.isFinite(midnightUtc) ||
    new Date(midnightUtc).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  const start = midnightUtc - KST_OFFSET_MS;
  const end = start + 24 * 3600_000;
  return { start, end };
}

type ParsedWhyMovedResponse = {
  title: string;
  oneLine: string;
  why: string;
  points: string[];
};

function parseWhyMovedResponse(content: string): ParsedWhyMovedResponse {
  try {
    const json = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const candidate: unknown = JSON.parse(json);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("response must be an object");
    }
    const value = candidate as Record<string, unknown>;
    if (
      typeof value.title !== "string" ||
      !value.title.trim() ||
      typeof value.oneLine !== "string" ||
      !value.oneLine.trim() ||
      typeof value.why !== "string" ||
      !value.why.trim() ||
      !Array.isArray(value.points) ||
      value.points.length !== 5 ||
      !value.points.every(
        (point) => typeof point === "string" && point.trim().length > 0
      )
    ) {
      throw new Error("response does not match the why-moved schema");
    }
    return {
      title: value.title,
      oneLine: value.oneLine,
      why: value.why,
      points: value.points as string[],
    };
  } catch (error) {
    throw new Error(
      `Invalid Grok response (${(error as Error).message}): ${content.slice(0, 200)}`
    );
  }
}

export async function generateWhyMoved(
  asset: string,
  date: string,
  options?: { expectedPulseIds?: string[] }
): Promise<WhyMovedArticle | null> {
  ensureTable();
  asset = asset.toLowerCase();

  // pulse 찾기
  const { start, end } = kstDayBounds(date);
  const allPulses = getAllPulses();
  const diagnostics = getPulseLoadDiagnostics();
  if (diagnostics.invalidFiles.length || diagnostics.duplicateIds.length) {
    throw new Error(
      `Pulse input integrity check failed: ${formatPulseLoadDiagnostics(diagnostics)}`
    );
  }
  const pulses = allPulses.filter((p) => {
    const t = Date.parse(p.detectedAt);
    return t >= start && t < end && p.asset.toLowerCase() === asset;
  });
  if (pulses.length === 0) {
    // 이 날 해당 자산에 pulse 없으면 article 생성 X
    return null;
  }

  if (options?.expectedPulseIds) {
    const actual = pulses.map((pulse) => pulse.id).sort();
    const expected = [...options.expectedPulseIds].sort();
    if (
      actual.length !== expected.length ||
      actual.some((id, index) => id !== expected[index])
    ) {
      throw new Error(`Pulse set changed while generating ${asset} × ${date}`);
    }
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
    {
      promptVersion: PROMPT_VERSION,
      maxTokens: 700,
      temperature: 0.3,
      validateContent: parseWhyMovedResponse,
    }
  );

  const parsed = parseWhyMovedResponse(result.content);

  const article: WhyMovedArticle = {
    asset,
    date,
    title: parsed.title,
    oneLine: parsed.oneLine,
    why: parsed.why,
    points: parsed.points,
    pulses,
    sources: uniqueSources,
    generatedAt: new Date().toISOString(),
  };

  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO alpha_why_moved
        (asset, date, title, one_line, why, points, pulses, sources, generated_at, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset, date) DO UPDATE SET
         title=excluded.title,
         one_line=excluded.one_line,
         why=excluded.why,
         points=excluded.points,
         pulses=excluded.pulses,
         sources=excluded.sources,
         generated_at=excluded.generated_at,
         cost_usd=excluded.cost_usd`
    ).run(
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

    const seoPath = `/asset/${asset}/why-moved/${date}`;
    db.prepare(
      `INSERT INTO alpha_seo_pages
        (path, page_type, canonical_id, title, meta_description,
         index_policy, lastmod, generated_at, quality_score)
       VALUES (?, 'event', ?, ?, ?, 'index', ?, ?, 0.85)
       ON CONFLICT(path) DO UPDATE SET
         page_type=excluded.page_type,
         canonical_id=excluded.canonical_id,
         title=excluded.title,
         meta_description=excluded.meta_description,
         index_policy=excluded.index_policy,
         lastmod=excluded.lastmod,
         generated_at=excluded.generated_at,
         quality_score=excluded.quality_score`
    ).run(
      seoPath,
      `${asset}-${date}`,
      article.title,
      article.oneLine.slice(0, 200),
      article.generatedAt,
      article.generatedAt
    );
  })();

  return article;
}
