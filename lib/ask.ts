/**
 * Ask Alpha — RAG 기반 질문 답변.
 *
 * 흐름:
 * 1. 질문에서 관련 entity/topic/event 검색 (lib/search.ts)
 * 2. top 8 결과의 synthesis + label + URL 추출
 * 3. Grok에 컨텍스트 + 질문 → 답변 + 인용 ID 반환
 * 4. 결과 alpha_questions 테이블에 저장 (자동 SEO 페이지)
 *
 * 캐시: input_hash 기반 (lib/grok.ts ai_runs)
 * 비용: 답변당 ~$0.0005 (Grok input 1k + output 0.5k)
 */

import crypto from "node:crypto";
import { getDb } from "./db";
import { chat } from "./grok";
import { search } from "./search";
import { getEntity, getTopic, getEvent } from "./mic";
import { getSynthesis } from "./synthesis";

const PROMPT_VERSION = "ask-v1";

export type Citation = {
  label: string;
  url: string;
  type: "entity" | "topic" | "event" | "asset" | "creator";
};

export type AskResult = {
  questionHash: string;
  question: string;
  answer: string;
  citations: Citation[];
  costUsd: number;
  cached: boolean;
  generatedAt: string;
};

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_questions (
      hash TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      citations TEXT NOT NULL,
      cost_usd REAL,
      generated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alpha_questions_generated
      ON alpha_questions(generated_at DESC);
  `);
}

function questionHash(q: string): string {
  // normalize: lowercase, trim, collapse whitespace
  const norm = q.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function getCachedAnswer(question: string): AskResult | null {
  ensureTable();
  const hash = questionHash(question);
  const row = getDb()
    .prepare(`SELECT * FROM alpha_questions WHERE hash = ?`)
    .get(hash) as
    | {
        hash: string;
        question: string;
        answer: string;
        citations: string;
        cost_usd: number | null;
        generated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    questionHash: row.hash,
    question: row.question,
    answer: row.answer,
    citations: JSON.parse(row.citations) as Citation[],
    costUsd: row.cost_usd || 0,
    cached: true,
    generatedAt: row.generated_at,
  };
}

export function listRecentAnswers(limit = 30) {
  ensureTable();
  return getDb()
    .prepare(
      `SELECT hash, question, generated_at FROM alpha_questions
       ORDER BY generated_at DESC LIMIT ?`
    )
    .all(limit) as { hash: string; question: string; generated_at: string }[];
}

function buildContextFromHits(hits: ReturnType<typeof search>): {
  contextText: string;
  citations: Citation[];
} {
  const lines: string[] = [];
  const citations: Citation[] = [];
  for (const h of hits.slice(0, 8)) {
    if (h.kind === "entity") {
      const synth = getSynthesis("entity", h.item.id);
      const desc = synth?.oneLine || `영상 ${h.item.videoCount}편`;
      lines.push(`- [${h.item.label}] ${desc} (${h.href})`);
      citations.push({
        label: h.item.label,
        url: h.href,
        type: h.item.type === "asset" ? "asset" : "entity",
      });
    } else if (h.kind === "topic") {
      const synth = getSynthesis("topic", h.item.id);
      const desc = synth?.oneLine || h.item.description || `영상 ${h.item.videoCount}편`;
      lines.push(`- [${h.item.label}] ${desc} (${h.href})`);
      citations.push({ label: h.item.label, url: h.href, type: "topic" });
    } else if (h.kind === "event") {
      const synth = getSynthesis("event", h.item.id);
      const desc = synth?.oneLine || `${h.item.label}`;
      lines.push(`- [${h.item.label}] ${desc} (${h.href})`);
      citations.push({ label: h.item.label, url: h.href, type: "event" });
    } else if (h.kind === "creator") {
      lines.push(`- [채널: ${h.item.name}] ${h.item.notes || ""} (${h.href})`);
      citations.push({ label: h.item.name, url: h.href, type: "creator" });
    }
  }
  return { contextText: lines.join("\n"), citations };
}

export async function askAlpha(question: string): Promise<AskResult> {
  ensureTable();
  const hash = questionHash(question);

  const cached = getCachedAnswer(question);
  if (cached) return cached;

  // 토큰 분할 검색 — 긴 질문에서 의미있는 단어를 추출하여 각각 검색
  // 한국어 조사 제거 (BTC를 → BTC, 한국에서 → 한국)
  const stripJosa = (t: string): string => {
    const josa = ["을", "를", "은", "는", "이", "가", "에", "의", "와", "과",
      "도", "만", "도록", "에서", "에게", "께", "보다", "부터", "까지", "처럼",
      "라도", "마다", "조차", "하고", "이나", "라서", "라니", "라며"];
    for (const j of josa.sort((a, b) => b.length - a.length)) {
      if (t.endsWith(j) && t.length > j.length + 1) return t.slice(0, -j.length);
    }
    return t;
  };

  const stopWords = new Set(["에서", "으로", "에는", "과는", "는가", "인가", "어떻게",
    "어떤", "무엇", "보는가", "만들고", "있는가", "있나", "있다", "되는가",
    "what", "which", "how", "when", "where", "why", "who", "the", "is",
    "are", "and", "or", "of", "in", "on", "to", "for", "with", "about",
    "그리고", "그러나", "또한", "또는", "그런데", "이것은", "그것은"]);

  const rawTokens = question
    .replace(/[?,.!~()[\]{}'"`;:]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const tokens = Array.from(
    new Set(
      rawTokens
        .flatMap((t) => [t, stripJosa(t)])
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !stopWords.has(t.toLowerCase()))
    )
  );

  // 전체 question + 각 토큰으로 검색, dedupe
  const seen = new Set<string>();
  const allHits: ReturnType<typeof search> = [];
  const tryAdd = (h: ReturnType<typeof search>[number]) => {
    const key = `${h.kind}:${h.kind === "creator" ? h.item.youtube_channel_id : h.item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    allHits.push(h);
  };

  for (const h of search(question, 4)) tryAdd(h);
  for (const tok of tokens.slice(0, 6)) {
    for (const h of search(tok, 4)) tryAdd(h);
  }

  // 점수 순 정렬 + top 10
  allHits.sort((a, b) => b.score - a.score);
  const hits = allHits.slice(0, 10);

  const { contextText, citations } = buildContextFromHits(hits);

  const prompt = `당신은 한국 크립토·매크로 시장 분석가 (Alpha by Mossland)입니다.
다음 컨텍스트만을 근거로 사용자 질문에 답하세요. 컨텍스트 외 내용은 추측하지 마세요.

== 컨텍스트 ==
${contextText || "(관련 데이터 없음)"}

== 사용자 질문 ==
${question}

답변 규칙:
- 한국어로 답변
- 답변 길이 ≤ 300자, 사실 + 다중 시각 포함
- 컨텍스트에 정확한 답이 없으면 "이 질문에는 충분한 데이터가 누적되지 않았습니다" 라고 솔직히 답
- 가격 권유 X · 정치 비방 X · 단정 X (가능성·관찰 어휘)
- 컨텍스트 라벨을 직접 인용 ("BTC", "FOMC" 등)
- 매수/매도 추천 X

응답: 답변 본문만. JSON X. citation은 별도 처리됨.`;

  const result = await chat(
    [
      {
        role: "system",
        content:
          "당신은 한국 크립토·매크로 미디어 큐레이터 Alpha입니다. 사실 + 다중 시각 + 출처 직링크가 핵심입니다.",
      },
      { role: "user", content: prompt },
    ],
    { promptVersion: PROMPT_VERSION, maxTokens: 500, temperature: 0.3 }
  );

  const answer = result.content.trim();
  const generatedAt = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT OR REPLACE INTO alpha_questions
        (hash, question, answer, citations, cost_usd, generated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      hash,
      question,
      answer,
      JSON.stringify(citations),
      result.costUsd,
      generatedAt
    );

  return {
    questionHash: hash,
    question,
    answer,
    citations,
    costUsd: result.costUsd,
    cached: result.cacheHit,
    generatedAt,
  };
}
