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
import { kstDayBounds } from "./kst";
import { chat } from "./grok";
import {
  formatPulseLoadDiagnostics,
  getAllPulses,
  getEntity,
  getPulseLoadDiagnostics,
  type Pulse,
} from "./mic";

// v2 (2026-08-19): 24-hour KST clock, UTC stamps inside summaries rewritten,
// confidence + 사후 검증 shown, title fixed, 3–5 points. Bumped so v1 rows are
// not replayed from cache.
const PROMPT_VERSION = "why-moved-v2";
const KST_OFFSET_MS = 9 * 3600_000;

/** HH:MM in KST, 24-hour. toLocaleTimeString("ko-KR") gave "오전 12:20" for
 *  00:20 and the model wrote "12:20 KST" in the article. */
function kstHm(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + KST_OFFSET_MS).toISOString().slice(11, 16) : "--:--";
}
/** Flatten free text for a prompt line: SignalMap writes raw UTC ISO stamps
 *  ("2026-08-18T16:11:59.999Z 기준 …") into pulse summaries; rewrite them as
 *  KST so the model is not handed two clocks. Cut on a sentence boundary. */
function promptText(text: string | null | undefined, max: number): string {
  const flat = (text ?? "")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z/g, (m) => `${kstHm(m)} KST`)
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const at = Math.max(cut.lastIndexOf("다."), cut.lastIndexOf(". "), cut.lastIndexOf("."));
  return at > max * 0.5 ? cut.slice(0, at + 1) : cut;
}

/**
 * Is this day's pulse set worth an article?
 *
 * The cron used to build an article for every asset that had ANY pulse, and
 * SignalMap's adaptive floor fires on ~0.2% moves on quiet days — so the site
 * published indexed NewsArticles titled "왜 움직였나" about a 0.19% five-minute
 * blip whose own text said the cause was unconfirmed. Require a real move.
 */
export const ARTICLE_MIN_SINGLE_MOVE_PCT = 0.5;
export const ARTICLE_MIN_NET_MOVE_PCT = 1.0;
export function whyMovedIndexPolicy(pulses: Pulse[]): "index" | "noindex" {
  return articleWorthy(pulses) ? "index" : "noindex";
}

export function articleWorthy(pulses: Pulse[]): boolean {
  if (!pulses.length) return false;
  const maxAbs = Math.max(...pulses.map((p) => Math.abs(p.magnitudePct)));
  if (maxAbs >= ARTICLE_MIN_SINGLE_MOVE_PCT) return true;
  const sorted = [...pulses].sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt));
  const first = sorted.find((p) => Number.isFinite(p.priceFrom))?.priceFrom;
  const last = [...sorted].reverse().find((p) => Number.isFinite(p.priceTo))?.priceTo;
  if (first && last) return Math.abs(((last - first) / first) * 100) >= ARTICLE_MIN_NET_MOVE_PCT;
  return false;
}

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

/** [start, end) epoch-ms bounds of a KST calendar day. Throws on an invalid
 *  date so callers cannot silently query an empty window. Defined in lib/kst.ts
 *  — the brief page needs it too — and re-exported here for existing importers. */
export { kstDayBounds };

/**
 * Render a pulse price with its unit for prompt text.
 *
 * SignalMap states the unit per pulse; anything it does not state is left
 * unlabelled rather than guessed, since a wrong currency is worse than none.
 */
function fmtPulsePrice(n: number, unit?: string): string {
  const v = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  // priceUnit is the one pulse field lib/mic.ts does not type-check, so a
  // malformed file could hand us a number or an object here.
  if (typeof unit !== "string") return v;
  switch (unit.trim().toUpperCase()) {
    case "KRW": return `${v}원`;
    case "USD": return `$${v}`;
    case "PT": return `${v}pt`;
    default: return v;
  }
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
    // The title is no longer the model's to write (see generateWhyMoved) —
    // it authored "GLD, 6% 국채금리 급등에 0.4% 하락" over a pulse whose own
    // 사후 검증 called the cause unconfirmed. Points: 3–5, so a one-fact day
    // does not force two invented slots.
    if (
      typeof value.oneLine !== "string" ||
      !value.oneLine.trim() ||
      typeof value.why !== "string" ||
      !value.why.trim() ||
      !Array.isArray(value.points) ||
      value.points.length < 3 ||
      value.points.length > 5 ||
      !value.points.every(
        (point) => typeof point === "string" && point.trim().length > 0
      )
    ) {
      throw new Error("response does not match the why-moved schema");
    }
    return {
      title: typeof value.title === "string" ? value.title : "",
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
      // State the unit. A bare "90,557,000 → 90,735,000" for a KRW-quoted
      // pulse reads as dollars to the model, and roughly a third of active
      // pulses are KRW-quoted (BTC-KRW, USDKRW).
      const money = (n?: number) => (n == null ? "?" : fmtPulsePrice(n, p.priceUnit));
      const head = `- ${kstHm(p.detectedAt)} KST: ${dirSign}${Math.abs(p.magnitudePct).toFixed(2)}% (${money(p.priceFrom)} → ${money(p.priceTo)}) [신뢰도: ${p.confidence}] — ${promptText(p.summary, 320)}`;
      // The verifier's verdict is the most honest sentence in the data and
      // was never shown to the model — so the article asserted causes the
      // 사후 검증 had already called unconfirmed.
      const verified = p.verifiedSummary ? `\n    사후 검증: ${promptText(p.verifiedSummary, 320)}` : "";
      return head + verified;
    })
    .join("\n");

  const sourceLines = uniqueSources
    .map((s) => {
      const when = s.publishedAt ? ` · 발행 ${kstHm(s.publishedAt)} KST` : "";
      const excerpt = s.excerpt ? ` · 발췌: ${promptText(s.excerpt, 160)}` : "";
      return `- ${s.title || s.url} (${s.publisher || "source"})${when}${excerpt}`;
    })
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
  "oneLine": "한 줄 결론 (≤80자, 사실 + 인사이트)",
  "why": "왜 중요한가 (≤120자)",
  "points": [
    "확인된 사실 (≤50자)",
    "가능한 원인 (≤50자) — 자료에 있을 때만",
    "다른 해석 (≤50자) — 자료에 있을 때만",
    "연결된 자산/매크로 (≤50자) — 자료에 있을 때만",
    "아직 불확실한 것 (≤50자)"
  ]
}
points 는 3~5개. 해당 근거가 자료에 없는 슬롯은 생략하고, 슬롯끼리 같은 말을 반복하지 않는다.

규칙:
- 한국어 출력
- 가격 권유 X · 정치 비방 X · 단정 X
- 위 자료의 시각은 전부 KST 다. 시차·경과 시간을 계산하지 말고 표기된 시각만 쓴다.
- 변동률·가격은 위 시그널 줄의 수치 그대로. 여러 건을 합산하지 않는다.
- 사후 검증이 인과를 부정하거나 미확인으로 두면 한 줄 결론에서 그 원인을 단정하지 않는다. speculative 시그널은 원인 서술 대신 미확인으로 쓴다.
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
    // Deterministic — the intended SEO form (scripts/audit-baseline.ts Q1),
    // and it takes the whole class of model-authored causal titles off the
    // table.
    title: `오늘 ${assetLabel}는 왜 움직였나? — ${date}`,
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
       VALUES (?, 'event', ?, ?, ?, ?, ?, ?, ?)
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
      // A day the gate would not have written about today does not belong in
      // the sitemap either. 357 of the 683 articles already on disk were
      // generated before articleWorthy() existed, over ~0.2% five-minute
      // moves; they stay reachable (no 404, no lost inbound link) but stop
      // asking to be indexed. The page's own robots meta is derived from the
      // same call, so head and sitemap agree.
      whyMovedIndexPolicy(pulses),
      article.generatedAt,
      article.generatedAt,
      articleWorthy(pulses) ? 0.85 : 0.3
    );
  })();

  return article;
}
