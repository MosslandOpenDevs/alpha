/**
 * Grok API 클라이언트 — xAI compatible OpenAI-style chat completions.
 *
 * env: GROK_API_KEY, GROK_MODEL (default: grok-4-1-fast-non-reasoning)
 *
 * 비용 추적: 모든 호출이 ai_runs 테이블에 cost_usd로 기록 (W1 캐시 §1.3).
 */

import crypto from "node:crypto";
import { getDb } from "./db";
import { kstClock, kstDayBounds } from "./kst";

const GROK_API_BASE = "https://api.x.ai/v1";
const DEFAULT_MODEL = process.env.GROK_MODEL || "grok-4-1-fast-non-reasoning";

// xAI grok-4-1-fast-non-reasoning pricing (per 1M tokens, 추정)
// 정확 가격은 xAI 공식 문서 — 변동 시 갱신
const PRICING = {
  inputUsdPerMillion: 0.2,
  outputUsdPerMillion: 0.5,
};

export const GROK_AVAILABLE = !!process.env.GROK_API_KEY;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** 캐시 무효화에 사용 (프롬프트 변경 시 bump) */
  promptVersion?: string;
  /** Reject malformed model output before it can enter the shared cache. */
  validateContent?: (content: string) => void;
};

export type ChatResult = {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  costUsd: number;
  cacheHit: boolean;
};

function hashInput(model: string, promptVersion: string, messages: ChatMessage[]): string {
  return crypto
    .createHash("sha256")
    .update(model)
    .update("|")
    .update(promptVersion)
    .update("|")
    .update(JSON.stringify(messages))
    .digest("hex");
}

function ensureAiRunsTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS alpha_ai_runs (
      id TEXT PRIMARY KEY,
      input_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      output_text TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_alpha_ai_runs_hash
      ON alpha_ai_runs(input_hash);
    -- todayAiSpendUsd() filters on created_at; without this it is a full scan
    -- of an unbounded response cache.
    CREATE INDEX IF NOT EXISTS idx_alpha_ai_runs_created
      ON alpha_ai_runs(created_at);
  `);
}

function readCache(inputHash: string): {
  content: string;
  usage?: ChatResult["usage"];
  costUsd: number;
} | null {
  ensureAiRunsTable();
  const row = getDb()
    .prepare(
      `SELECT output_text, input_tokens, output_tokens, cost_usd
       FROM alpha_ai_runs WHERE input_hash = ?`
    )
    .get(inputHash) as
    | {
        output_text: string;
        input_tokens: number | null;
        output_tokens: number | null;
        cost_usd: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    content: row.output_text,
    usage:
      row.input_tokens != null && row.output_tokens != null
        ? {
            prompt_tokens: row.input_tokens,
            completion_tokens: row.output_tokens,
            total_tokens: row.input_tokens + row.output_tokens,
          }
        : undefined,
    costUsd: row.cost_usd || 0,
  };
}

function writeCache(args: {
  inputHash: string;
  model: string;
  promptVersion: string;
  output: string;
  usage?: ChatResult["usage"];
  costUsd: number;
}) {
  ensureAiRunsTable();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO alpha_ai_runs
        (id, input_hash, model, prompt_version, output_text,
         input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      args.inputHash,
      args.inputHash,
      args.model,
      args.promptVersion,
      args.output,
      args.usage?.prompt_tokens ?? null,
      args.usage?.completion_tokens ?? null,
      args.costUsd,
      new Date().toISOString()
    );
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<ChatResult> {
  if (!GROK_AVAILABLE) {
    throw new Error("GROK_API_KEY not set");
  }

  const model = opts.model || DEFAULT_MODEL;
  const promptVersion = opts.promptVersion || "v1";
  const inputHash = hashInput(model, promptVersion, messages);

  const cached = readCache(inputHash);
  if (cached) {
    try {
      opts.validateContent?.(cached.content);
      return { ...cached, cacheHit: true };
    } catch {
      // A validator introduced after an older run may discover a poisoned
      // cache entry. Keep it for provenance until a validated fresh response
      // atomically replaces this exact prompt hash below.
    }
  }

  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 800,
  };

  const res = await fetch(`${GROK_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grok API ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: ChatResult["usage"];
  };
  const content = data.choices[0]?.message?.content || "";
  opts.validateContent?.(content);
  const usage = data.usage;
  const costUsd = usage
    ? (usage.prompt_tokens * PRICING.inputUsdPerMillion +
        usage.completion_tokens * PRICING.outputUsdPerMillion) /
      1_000_000
    : 0;

  writeCache({
    inputHash,
    model,
    promptVersion,
    output: content,
    usage,
    costUsd,
  });

  return { content, usage, costUsd, cacheHit: false };
}

/**
 * Today's (KST) non-cached Grok spend — **every** caller, not just crons.
 *
 * Cron scripts never call `addCost()`: that counter enforces the per-IP and
 * global ceiling on *user-facing* endpoints, and charging unattended pipeline
 * work against it would let a busy morning of crons lock /api/ask out for real
 * visitors. But leaving pipeline spend uncounted meant /health read
 * "$0.0000 today · 0 calls" after every paid cron.
 *
 * `alpha_ai_runs` has no caller column, so this total includes /api/ask and
 * MCP traffic as well — those are also metered separately by `addCost()`, so
 * the two figures on /health overlap and must not be added together. Labelled
 * accordingly there. Cache hits add nothing (unique index on input_hash), and
 * scripts/audit-auto.ts bills OpenAI directly without passing through
 * `chat()`, so its spend is not represented at all.
 */
export function todayAiSpendUsd(): { costUsd: number; runCount: number } {
  ensureAiRunsTable();
  const { start } = kstDayBounds(kstClock().date);
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS n
       FROM alpha_ai_runs WHERE created_at >= ?`
    )
    .get(new Date(start).toISOString()) as { cost: number; n: number };
  return { costUsd: row.cost, runCount: row.n };
}
