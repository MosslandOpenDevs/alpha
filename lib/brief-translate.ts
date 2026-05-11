/**
 * English translation of the daily Korean brief.
 *
 * Translates a generated Korean BriefSummary to English via Grok, caches
 * by (date, source-hash) so the same Korean brief never gets re-translated.
 * Surfaced at /en/brief/[date] — designed to be picked up by English LLM
 * crawlers (Bing/Google for English content indexes faster than Korean
 * for fresh domains).
 */

import { chat, type ChatMessage } from "./grok";
import { getDb } from "./db";
import { getBriefSummary, type BriefSummary } from "./brief";
import crypto from "node:crypto";

const PROMPT_VERSION = "brief-translate-v1";

export type BriefSummaryEn = {
  date: string;
  oneLine: string;
  why: string;
  points: string[];
  quotes: { text: string; source: string }[];
  /** When the *English* translation was generated. */
  translatedAt: string;
  /** When the underlying Korean brief was generated (lets us detect stale
   *  translation if Korean is regenerated). */
  sourceGeneratedAt: string;
};

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_brief_translations (
      date TEXT NOT NULL,
      lang TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      one_line TEXT NOT NULL,
      why TEXT,
      points TEXT NOT NULL,
      quotes TEXT NOT NULL,
      translated_at TEXT NOT NULL,
      cost_usd REAL,
      PRIMARY KEY (date, lang)
    );
  `);
}

function sourceHash(b: BriefSummary): string {
  return crypto
    .createHash("sha256")
    .update(b.oneLine)
    .update("|")
    .update(b.why || "")
    .update("|")
    .update(b.points.join("\n"))
    .digest("hex")
    .slice(0, 16);
}

export function getBriefEn(date: string): BriefSummaryEn | null {
  ensureTable();
  const src = getBriefSummary(date);
  if (!src) return null;
  const row = getDb()
    .prepare(
      `SELECT one_line, why, points, quotes, translated_at, source_hash
       FROM alpha_brief_translations WHERE date = ? AND lang = 'en'`
    )
    .get(date) as
    | {
        one_line: string;
        why: string | null;
        points: string;
        quotes: string;
        translated_at: string;
        source_hash: string;
      }
    | undefined;
  if (!row) return null;
  // Stale check — if the Korean brief was regenerated (different hash),
  // we don't have a current translation. Return null so caller refreshes.
  if (row.source_hash !== sourceHash(src)) return null;
  return {
    date,
    oneLine: row.one_line,
    why: row.why || "",
    points: JSON.parse(row.points),
    quotes: JSON.parse(row.quotes),
    translatedAt: row.translated_at,
    sourceGeneratedAt: src.generatedAt,
  };
}

export async function generateBriefEn(date: string): Promise<
  | { en: BriefSummaryEn; cacheHit: boolean; costUsd: number }
  | null
> {
  ensureTable();
  const src = getBriefSummary(date);
  if (!src) return null;

  const cached = getBriefEn(date);
  if (cached) return { en: cached, cacheHit: true, costUsd: 0 };

  // Build a translation prompt. Keep Smart Brevity: one-line ≤ 90 chars
  // English (longer than Korean naturally), points each ≤ 110 chars.
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a translator specialized in Korean financial / crypto / macro news. " +
        "Translate the structured Korean brief to English. Preserve numbers, tickers, " +
        "and named entities exactly. Keep the same Smart-Brevity tone — one-line is a " +
        "tweet-sized headline, points are tight bullets, quotes are short. Use natural " +
        "English; do not translate word-for-word. " +
        "Output strict JSON with this shape: " +
        `{"oneLine": "...", "why": "...", "points": ["...", ...], "quotes": [{"text": "...", "source": "..."}, ...]}. ` +
        "Do not include any explanation outside the JSON.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          date: src.date,
          oneLine: src.oneLine,
          why: src.why,
          points: src.points,
          quotes: src.quotes,
        },
        null,
        2
      ),
    },
  ];

  const result = await chat(messages, {
    promptVersion: PROMPT_VERSION,
    temperature: 0.2,
    maxTokens: 1200,
  });

  let parsed: {
    oneLine: string;
    why?: string;
    points: string[];
    quotes: { text: string; source: string }[];
  };
  try {
    // Tolerate code-fenced JSON
    const text = result.content.trim().replace(/^```(?:json)?|```$/g, "").trim();
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`brief-translate: invalid JSON from LLM: ${(err as Error).message}`);
  }

  const en: BriefSummaryEn = {
    date,
    oneLine: parsed.oneLine,
    why: parsed.why || "",
    points: parsed.points || [],
    quotes: parsed.quotes || [],
    translatedAt: new Date().toISOString(),
    sourceGeneratedAt: src.generatedAt,
  };

  getDb()
    .prepare(
      `INSERT OR REPLACE INTO alpha_brief_translations
         (date, lang, source_hash, one_line, why, points, quotes, translated_at, cost_usd)
       VALUES (?, 'en', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      date,
      sourceHash(src),
      en.oneLine,
      en.why,
      JSON.stringify(en.points),
      JSON.stringify(en.quotes),
      en.translatedAt,
      result.costUsd
    );

  return { en, cacheHit: result.cacheHit, costUsd: result.costUsd };
}

/** List all dates that have at least an English translation cached. */
export function listEnDates(): string[] {
  ensureTable();
  return (
    getDb()
      .prepare(
        `SELECT date FROM alpha_brief_translations WHERE lang = 'en' ORDER BY date DESC`
      )
      .all() as { date: string }[]
  ).map((r) => r.date);
}
