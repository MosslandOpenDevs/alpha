/**
 * Daily brief AI 요약 — /brief/[date] 페이지 상단 자동 5-블록 카드.
 *
 * 입력 (전부 그 KST 날짜의 것):
 *   - 가격 시그널: 그날의 pulse 를 자산별로 집계 (건수·시가→종가·최대 변동·
 *     대표 pulse 의 사후 검증 요약)
 *   - 매크로: 미·한 핵심 시리즈의 그날 기준 최신 관측치와 전일 대비
 *   - 그날 올라온 시장 영상: SignalMap 인덱스에서 economy 카테고리 + 시장 키워드
 *     뉴스, 채널·시각·제목·한 줄 요약. 대표 인용은 여기서만.
 *   - 그 영상들에 등장한 엔티티·토픽·이벤트 (전체 기간 인기순이 아니라)
 * 출력: oneLine + why + points[3-5] + quotes[0-n]
 *
 * 왜 이렇게 바꿨나 (2026-08-19 콘텐츠 검토): 8/18 은 코스피가 장중 -5.3% 로
 * 7,000 을 내주고 글로벌 채권이 팔린 날인데 브리프는 "반도체 강세" 로 시작했고
 * 내일 볼 것은 "6월 FOMC" 였다. 43개 pulse 중 최신 4개(전부 크립토 ±0.2%)만
 * 넣고, 매크로는 읽지 않았고, 전체 기간 top-N 엔티티를 "오늘 갱신" 이라 라벨해
 * 넘겼기 때문이다. 모델은 받은 것을 성실히 요약했다 — 문제는 받은 것이었다.
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
  getVideosPublishedBetween,
  getVideo,
  type Pulse,
  type VideoIndexEntry,
} from "./mic";
import { getSynthesis } from "./synthesis";
import { getRecentObservations } from "./fred";

const PROMPT_VERSION = "brief-v3";

// ── input construction ───────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 3600_000;
const fmtKstHm = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + KST_OFFSET_MS).toISOString().slice(11, 16) : "--:--";
};
/** Flatten a free-text field for a prompt line: no newlines, capped, ISO
 *  timestamps (SignalMap writes UTC ones into summaries) rewritten as KST. */
const line = (text: string | undefined | null, max: number): string =>
  (text ?? "")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z/g, (m) => `${fmtKstHm(m)} KST`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const CONFIDENCE_RANK: Record<string, number> = { confirmed: 3, reported: 2, discussed: 1, speculative: 0 };

/** Per-asset day aggregate — what the day looked like for each instrument,
 *  not the four most recent five-minute blips. */
function pulseAggregateLines(pulses: Pulse[], maxAssets = 8): string[] {
  const byAsset = new Map<string, Pulse[]>();
  for (const p of pulses) {
    const k = (p.assetLabel || p.asset).toUpperCase();
    if (!byAsset.has(k)) byAsset.set(k, []);
    byAsset.get(k)!.push(p);
  }
  const groups = [...byAsset.entries()]
    .map(([label, ps]) => {
      const sorted = [...ps].sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt));
      const first = sorted.find((p) => Number.isFinite(p.priceFrom))?.priceFrom;
      const last = [...sorted].reverse().find((p) => Number.isFinite(p.priceTo))?.priceTo;
      const net = first && last ? ((last - first) / first) * 100 : null;
      const maxAbs = Math.max(...ps.map((p) => Math.abs(p.magnitudePct)));
      const rep = [...ps].sort(
        (a, b) =>
          (CONFIDENCE_RANK[b.confidence] ?? 0) - (CONFIDENCE_RANK[a.confidence] ?? 0) ||
          Math.abs(b.magnitudePct) - Math.abs(a.magnitudePct)
      )[0];
      const unit = ps[0].priceUnit ? ` ${ps[0].priceUnit}` : "";
      return { label, ps, first, last, net, maxAbs, rep, unit };
    })
    // Korean-market instruments and bigger moves first.
    .sort((a, b) => Math.abs(b.net ?? b.maxAbs) - Math.abs(a.net ?? a.maxAbs));
  return groups.slice(0, maxAssets).map((g) => {
    const range =
      g.first != null && g.last != null && g.net != null
        ? `${g.first.toLocaleString("en-US", { maximumFractionDigits: 2 })} → ${g.last.toLocaleString("en-US", { maximumFractionDigits: 2 })}${g.unit} (${g.net >= 0 ? "+" : ""}${g.net.toFixed(2)}%)`
        : "가격 범위 미상";
    const rep = g.rep;
    const repText = line(rep.verifiedSummary || rep.summary, 220);
    // "첫 시그널→마지막 시그널" is an intraday span between two detections,
    // not open→close; say so, or the model writes "마감" (it did).
    return `- ${g.label}: 시그널 ${g.ps.length}건, 첫→마지막 시그널 구간 ${range} (시가·종가 아님), 최대 5분 변동 ${g.maxAbs.toFixed(2)}% · 대표(${fmtKstHm(rep.detectedAt)} KST, 신뢰도 ${rep.confidence}): ${repText}`;
  });
}

const MACRO_SERIES = ["DGS10", "T10Y2Y", "DFF", "KR_GOV3Y", "KR_USDKRW_BOK", "KR_BASE_RATE"];
const MACRO_LABEL: Record<string, string> = {
  DGS10: "미 10년물", T10Y2Y: "미 10y-2y", DFF: "연방기금금리",
  KR_GOV3Y: "국고채 3년", KR_USDKRW_BOK: "원/달러(한은)", KR_BASE_RATE: "한은 기준금리",
};

/** Latest observation on or before `date`, with the change from the one before. */
function macroLines(date: string): string[] {
  const out: string[] = [];
  for (const id of MACRO_SERIES) {
    const obs = getRecentObservations(id, 40).filter((o) => o.date <= date && o.value != null);
    if (!obs.length) continue;
    const cur = obs[0];
    const prev = obs[1];
    const delta = prev && prev.value != null && cur.value != null ? cur.value - prev.value : null;
    const staleNote = cur.date < date ? ` (관측일 ${cur.date.slice(5)})` : "";
    out.push(
      `- ${MACRO_LABEL[id] ?? id}: ${cur.value}${delta != null ? ` (전 관측 대비 ${delta >= 0 ? "+" : ""}${delta.toFixed(2)})` : ""}${staleNote}`
    );
  }
  return out;
}

const MARKET_RE =
  /코스피|코스닥|증시|주가|환율|원\/달러|달러|금리|국채|채권|비트코인|이더리움|암호화폐|가상자산|반도체|나스닥|S&P|다우|연준|Fed|FOMC|한은|기준금리|물가|CPI|유가|금값|외국인|반등|급락|급등|하락|상승|실적|투자|주식/g;

/** How much a video is about markets: keyword hits in title + one-liner,
 *  plus one for the economy category (analysis, not headlines). */
function marketScore(v: VideoIndexEntry): number {
  const text = `${v.videoTitle ?? ""} ${v.summaryOneline ?? ""}`;
  const hits = text.match(MARKET_RE)?.length ?? 0;
  return hits + (v.category === "economy" ? 1 : 0);
}

/** Same-day videos a market reader would want, most market-relevant first.
 *  On 2026-08-18 the day had 1,564 videos; newest-first put a missing-person
 *  documentary and a Space Force piece (both filed under economy) ahead of
 *  "국채금리 급등에 반도체 무너졌다". Score first, recency second. */
function marketVideos(start: number, end: number): VideoIndexEntry[] {
  const seenTitle = new Set<string>();
  return getVideosPublishedBetween(start, end)
    .filter((v) => v.summaryOneline)
    .map((v) => ({ v, score: marketScore(v) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || Date.parse(b.v.publishedAt!) - Date.parse(a.v.publishedAt!))
    .map((x) => x.v)
    // Broadcasters re-upload the same segment (YTN posted "코스피·코스닥,
    // 엿새 만에 하락 전환" twice on 8/18); keep the first.
    .filter((v) => {
      const key = (v.videoTitle ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!key || seenTitle.has(key)) return false;
      seenTitle.add(key);
      return true;
    });
}

/** Canonical entities/topics/events ranked by how many of the day's market
 *  videos they are linked to — "what the day was about", not all-time size. */
function rankByDayVideos<T extends { id: string; label: string; videoIds?: string[] }>(
  items: T[],
  dayVideoIds: Set<string>,
  limit: number
): { item: T; hits: number }[] {
  return items
    .map((item) => ({ item, hits: (item.videoIds ?? []).filter((id) => dayVideoIds.has(id)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
}

export type BriefInputs = {
  pulseLines: string[];
  macroLines: string[];
  videoLines: string[];
  claimLines: string[];
  quotePool: { text: string; source: string }[];
  entityLines: string[];
  topicLines: string[];
  eventLines: string[];
  counts: { pulses: number; dayVideos: number; marketVideos: number };
};

/** Everything the model will see for `date`, as text blocks. Exported so the
 *  input side can be inspected without a model call. */
export function buildBriefInputs(date: string): BriefInputs {
  const { start, end } = dayBounds(date);
  const pulses = getAllPulses().filter((p) => {
    const t = Date.parse(p.detectedAt);
    return t >= start && t < end;
  });
  const dayVideosAll = getVideosPublishedBetween(start, end);
  const marketAll = marketVideos(start, end);
  const vids = marketAll.slice(0, 12);
  // Entities/topics/events are ranked against every market video of the day,
  // not just the twelve shown, so "what the day was about" is not an artefact
  // of the display cap.
  const dayIds = new Set(marketAll.map((v) => v.videoId));

  const videoLines = vids.map(
    (v) =>
      `- (${line(v.channelName, 24)}, ${fmtKstHm(v.publishedAt!)} KST) ${line(v.videoTitle, 70)} — ${line(v.summaryOneline, 140)}`
  );
  // The index carries each video's claims (checkable sentences) but not its
  // verbatim quotes; those live in the per-video file. Read only the top few.
  const claimLines: string[] = [];
  for (const v of vids.slice(0, 8)) {
    const c = (v.claims ?? []).find((x) => (typeof x === "string" ? x.trim() : (x as { text?: string })?.text));
    const text = typeof c === "string" ? c : (c as { text?: string } | undefined)?.text;
    if (text) claimLines.push(`- (${line(v.channelName, 24)}) ${line(text, 110)}`);
  }
  const quotePool: { text: string; source: string }[] = [];
  for (const v of vids.slice(0, 6)) {
    const rec = getVideo(v.videoId);
    const q = (rec?.analysis?.quotes ?? []).find((x) => x?.text && x.text.trim().length >= 8);
    if (q && v.channelName) quotePool.push({ text: line(q.text, 80), source: line(v.channelName, 24) });
  }

  const ents = rankByDayVideos(getAllEntities(), dayIds, 8);
  const entityLines = ents.map(({ item: e, hits }) => {
    const s = getSynthesis("entity", e.id);
    const synth = s ? ` · 합성 카드(${s.generatedAt.slice(5, 10)}): ${line(s.oneLine, 90)}` : "";
    return `- ${e.label} (오늘 영상 ${hits}편)${synth}`;
  });
  const topicLines = rankByDayVideos(getAllTopics(), dayIds, 6).map(
    ({ item: t, hits }) => `- ${t.label} (오늘 영상 ${hits}편)${t.description ? `: ${line(t.description, 90)}` : ""}`
  );
  const eventLines = rankByDayVideos(getAllEvents(), dayIds, 6).map(
    ({ item: ev, hits }) => `- ${ev.label} (오늘 영상 ${hits}편${ev.dateHint ? `, 시점: ${ev.dateHint}` : ", 시점 미상"})`
  );

  return {
    pulseLines: pulseAggregateLines(pulses),
    macroLines: macroLines(date),
    videoLines,
    claimLines,
    quotePool,
    entityLines,
    topicLines,
    eventLines,
    counts: { pulses: pulses.length, dayVideos: dayVideosAll.length, marketVideos: marketAll.length },
  };
}

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

  const inp = buildBriefInputs(date);
  const nonEmpty = inp.pulseLines.length + inp.videoLines.length + inp.macroLines.length;
  if (nonEmpty === 0) {
    throw new Error(`No data for ${date}`);
  }
  const block = (lines: string[]) => (lines.length ? lines.join("\n") : "(없음)");
  const quoteLines = inp.quotePool.map((q) => `- "${q.text}" — ${q.source}`);

  const prompt = `${date} (KST) 한국 시장 일일 브리프. 아래는 전부 이 날짜의 자료입니다.

가격 시그널 — 자산별 하루 집계 (5분 단위 감지 ${inp.counts.pulses}건):
${block(inp.pulseLines)}

매크로 (${date} 기준 최신 관측치):
${block(inp.macroLines)}

이 날 올라온 시장 영상 (관련도 상위 ${inp.videoLines.length}편 / 시장 관련 ${inp.counts.marketVideos}편 / 전체 ${inp.counts.dayVideos}편):
${block(inp.videoLines)}

영상의 핵심 주장:
${block(inp.claimLines)}

대표 인용 (여기 있는 문장만 인용 가능):
${block(quoteLines)}

이 날 영상에 등장한 엔티티 (합성 카드는 다른 날 생성된 배경 정보):
${block(inp.entityLines)}

이 날 영상의 토픽:
${block(inp.topicLines)}

이 날 영상의 이벤트 (시점 표기 확인):
${block(inp.eventLines)}

위 자료만으로 ${date} 한국 시장 한 컷을 작성. 응답은 *오직 JSON*. markdown 백틱 X.

스키마:
{
  "oneLine": "이 날의 한국 시장 한 줄 요약 (≤80자)",
  "why": "왜 이 날이 중요한가 (≤120자)",
  "points": ["핵심 변화 (≤40자)", "핵심 변화 (≤40자)", "핵심 변화 (≤40자)", "다른 시각 (≤40자)", "내일 볼 것 (≤40자)"],
  "quotes": [{"text": "대표 인용에서 그대로 (≤80자)", "source": "채널명"}]
}

규칙:
- 한국어. 가격 권유 X. 정치 인물 비방 X.
- 위 자료에 없는 사실·날짜·수치·인과를 쓰지 않는다. 자료의 표현(교착/합의/결렬 등)을 바꾸지 않는다.
- 코스피·환율·금리 등 한국 시장 지표가 자료에 있으면 그것이 먼저다. 크립토는 그 다음.
- 5분 변동 1% 미만은 "급등/급락" 이라 쓰지 않는다. 하루 집계 순변화를 본다.
- 시그널 구간 변화는 시가·종가가 아니다 — "마감", "종가" 라 쓰지 않는다.
- 합성 카드는 그날 뉴스가 아니라 배경이다. 이 날 자료와 맞을 때만 쓴다.
- "내일 볼 것" 은 자료에서 시점이 ${date} 이후로 확인되는 일정만. 없으면 "확인된 예정 일정 없음".
- 자료가 부족한 슬롯은 억지로 채우지 말고 생략한다 (points 는 3~5개).
- quotes 는 대표 인용에서만 그대로. 없으면 [].`;

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

  const allowedSources = new Set(inp.quotePool.map((q) => q.source));
  const points = (Array.isArray(parsed.points) ? parsed.points : [])
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .slice(0, 5);
  if (points.length < 3) {
    throw new Error(`Too few points from Grok (${points.length})`);
  }
  // A quote the model did not take from the pool is not a quote — it is the
  // model's own sentence with a made-up source label ("엔티티 업데이트" was one).
  const quotes = (Array.isArray(parsed.quotes) ? parsed.quotes : []).filter(
    (q): q is { text: string; source: string } =>
      !!q && typeof q.text === "string" && typeof q.source === "string" && allowedSources.has(q.source)
  );
  const summary: BriefSummary = {
    date,
    oneLine: parsed.oneLine || "",
    why: parsed.why || "",
    points,
    quotes,
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
