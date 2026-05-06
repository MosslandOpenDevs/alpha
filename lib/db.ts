import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "data", "alpha-dev.sqlite");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  _db = db;
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS alpha_seo_pages (
      path TEXT PRIMARY KEY,
      page_type TEXT NOT NULL,
      canonical_id TEXT,
      title TEXT,
      meta_description TEXT,
      index_policy TEXT NOT NULL DEFAULT 'index',
      lastmod TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      quality_score REAL DEFAULT 0,
      raw_meta TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_alpha_seo_pages_index_policy
      ON alpha_seo_pages(index_policy);

    CREATE INDEX IF NOT EXISTS idx_alpha_seo_pages_page_type
      ON alpha_seo_pages(page_type);

    CREATE INDEX IF NOT EXISTS idx_alpha_seo_pages_lastmod
      ON alpha_seo_pages(lastmod DESC);
  `);
}

export type SeoPage = {
  path: string;
  page_type:
    | "home"
    | "asset"
    | "topic"
    | "event"
    | "creator"
    | "brief"
    | "compare"
    | "entity"
    | "community"
    | "agent";
  canonical_id?: string | null;
  title: string;
  meta_description?: string | null;
  index_policy: "index" | "noindex" | string;
  lastmod: string;
  generated_at: string;
  quality_score?: number;
};

export function upsertSeoPage(p: SeoPage) {
  const db = getDb();
  db.prepare(
    `INSERT INTO alpha_seo_pages
       (path, page_type, canonical_id, title, meta_description,
        index_policy, lastmod, generated_at, quality_score)
     VALUES (@path, @page_type, @canonical_id, @title, @meta_description,
             @index_policy, @lastmod, @generated_at, @quality_score)
     ON CONFLICT(path) DO UPDATE SET
       page_type=excluded.page_type,
       canonical_id=excluded.canonical_id,
       title=excluded.title,
       meta_description=excluded.meta_description,
       index_policy=excluded.index_policy,
       lastmod=excluded.lastmod,
       generated_at=excluded.generated_at,
       quality_score=excluded.quality_score`
  ).run({
    path: p.path,
    page_type: p.page_type,
    canonical_id: p.canonical_id ?? null,
    title: p.title,
    meta_description: p.meta_description ?? null,
    index_policy: p.index_policy,
    lastmod: p.lastmod,
    generated_at: p.generated_at,
    quality_score: p.quality_score ?? 0,
  });
}

export function getSeoPage(path: string): SeoPage | null {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM alpha_seo_pages WHERE path = ?`)
    .get(path) as SeoPage | null;
}

export function listIndexedPages(): SeoPage[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM alpha_seo_pages
       WHERE index_policy = 'index'
       ORDER BY lastmod DESC`
    )
    .all() as SeoPage[];
}

export function listRecentPages(limit = 100): SeoPage[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM alpha_seo_pages
       WHERE index_policy = 'index'
       ORDER BY lastmod DESC
       LIMIT ?`
    )
    .all(limit) as SeoPage[];
}
