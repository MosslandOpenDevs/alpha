/**
 * Embedding-based 의미 검색.
 *
 * - signalmap canonical entity/topic/event의 centroid (1536-dim) 재활용
 * - 사용자 query는 OpenAI text-embedding-3-small로 즉석 임베딩
 * - alpha_query_embeddings 테이블에 sha256 캐시 → 동일 query 재호출 0회
 * - cosine similarity로 top N 매칭
 *
 * 비용: query 1회 = ~$0.0000004 (text-embedding-3-small).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";

const MIC_DATA_PATH =
  process.env.MIC_DATA_PATH || path.join(process.cwd(), "mic-data");

const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const EMBED_DIM = 1536;

export const OPENAI_AVAILABLE = !!process.env.OPENAI_API_KEY;

// ─── canonical centroid 캐시 (lazy) ──────────────────────────────

type CanonicalEmbed = {
  id: string;
  label: string;
  centroid: number[];
};

let _entityEmbeds: CanonicalEmbed[] | null = null;
let _topicEmbeds: CanonicalEmbed[] | null = null;
let _eventEmbeds: CanonicalEmbed[] | null = null;

function loadCanonicalEmbeds(file: string): CanonicalEmbed[] {
  const p = path.join(MIC_DATA_PATH, file);
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const items = (raw.items || []) as { id: string; label: string; centroid?: number[] }[];
  return items
    .filter((it) => Array.isArray(it.centroid) && it.centroid.length === EMBED_DIM)
    .map((it) => ({ id: it.id, label: it.label, centroid: it.centroid! }));
}

export function getEntityEmbeds(): CanonicalEmbed[] {
  if (_entityEmbeds) return _entityEmbeds;
  _entityEmbeds = loadCanonicalEmbeds("canonical-entities.json");
  return _entityEmbeds;
}
export function getTopicEmbeds(): CanonicalEmbed[] {
  if (_topicEmbeds) return _topicEmbeds;
  _topicEmbeds = loadCanonicalEmbeds("canonical-topics.json");
  return _topicEmbeds;
}
export function getEventEmbeds(): CanonicalEmbed[] {
  if (_eventEmbeds) return _eventEmbeds;
  _eventEmbeds = loadCanonicalEmbeds("canonical-events.json");
  return _eventEmbeds;
}

// ─── query embedding (OpenAI + 캐시) ────────────────────────────

function ensureCacheTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_query_embeddings (
      query_hash TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      model TEXT NOT NULL,
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function hashQuery(q: string, model: string): string {
  return crypto
    .createHash("sha256")
    .update(model)
    .update("|")
    .update(q.trim().toLowerCase())
    .digest("hex");
}

function vectorToBuffer(v: number[]): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) {
    buf.writeFloatLE(v[i], i * 4);
  }
  return buf;
}

function bufferToVector(buf: Buffer): number[] {
  const v: number[] = [];
  for (let i = 0; i < buf.length; i += 4) {
    v.push(buf.readFloatLE(i));
  }
  return v;
}

export async function embedQuery(query: string): Promise<number[] | null> {
  if (!OPENAI_AVAILABLE) return null;
  ensureCacheTable();

  const hash = hashQuery(query, EMBED_MODEL);
  const cached = getDb()
    .prepare(
      `SELECT vector FROM alpha_query_embeddings WHERE query_hash = ?`
    )
    .get(hash) as { vector: Buffer } | undefined;
  if (cached) return bufferToVector(cached.vector);

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: query }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBED_DIM) return null;

    getDb()
      .prepare(
        `INSERT INTO alpha_query_embeddings (query_hash, query, model, vector, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(hash, query, EMBED_MODEL, vectorToBuffer(vec), new Date().toISOString());

    return vec;
  } catch {
    return null;
  }
}

// ─── cosine similarity 검색 ─────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export type SemanticHit = {
  kind: "entity" | "topic" | "event";
  id: string;
  label: string;
  similarity: number;
};

/** Query embedding → top N most similar canonical entities/topics/events. */
export async function semanticSearch(
  query: string,
  limit = 10,
  minSimilarity = 0.3
): Promise<SemanticHit[]> {
  const qVec = await embedQuery(query);
  if (!qVec) return [];

  const all: SemanticHit[] = [];
  for (const e of getEntityEmbeds()) {
    const sim = cosine(qVec, e.centroid);
    if (sim >= minSimilarity) all.push({ kind: "entity", id: e.id, label: e.label, similarity: sim });
  }
  for (const t of getTopicEmbeds()) {
    const sim = cosine(qVec, t.centroid);
    if (sim >= minSimilarity) all.push({ kind: "topic", id: t.id, label: t.label, similarity: sim });
  }
  for (const ev of getEventEmbeds()) {
    const sim = cosine(qVec, ev.centroid);
    if (sim >= minSimilarity) all.push({ kind: "event", id: ev.id, label: ev.label, similarity: sim });
  }

  all.sort((a, b) => b.similarity - a.similarity);
  return all.slice(0, limit);
}
