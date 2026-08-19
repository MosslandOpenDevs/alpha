/**
 * LLM citation audit — one row per run, so the result is readable by the app.
 *
 * The weekly audit (scripts/audit-auto.ts) has been asking gpt-4o web_search a
 * fixed query set every Monday and writing JSON to disk that no code ever
 * opened. Three dates are on record — 2026-05-06/11/18, 150 answers over 30
 * distinct queries — and the citation count is zero: alpha.moss.land was never
 * cited once. Nothing surfaced that anywhere.
 *
 * (A separate 2026-05-06 file holds a one-off four-vendor baseline, 120 more
 * answers, also zero. It is not this script's output and is not counted here.)
 * Paying to measure something nobody reads is the same failure as a health check
 * nobody watches, which is what most of this repo's recent work was about.
 *
 * Cost is deliberately not a column: scripts/audit-auto.ts does not track its
 * own spend (no usage accounting anywhere in it), and a cost_usd that is always
 * 0 reads as "this was free" rather than "this was never measured" — the exact
 * shape of the false-green this repo spent today removing.
 *
 * The JSON files stay: they hold the per-query citations and answer excerpts
 * needed to investigate *why*. This table holds only what a dashboard needs to
 * show a trend, so /health can read it without parsing a directory of files.
 */

import { getDb } from "./db";

export type AuditRun = {
  /** KST date of the run, YYYY-MM-DD. Primary key: one summary per day. */
  date: string;
  /** Answers received. A query can be asked more than once in a day, so this
   *  is NOT the query count — conflating them made a 30-query run read as 60. */
  answers: number;
  /** Distinct query ids asked. */
  queries: number;
  /** Answers that cited alpha.moss.land. */
  cited: number;
  /** Distinct query ids cited at least once. */
  distinctCited: number;
  /** Cited answers whose query category is "mossland". */
  mosslandCited: number;
  /** Answers that failed (API error). Without this a week where every call
   *  errored is indistinguishable from a week that genuinely scored 0%. */
  errors: number;
  createdAt: string;
};

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_audit_runs (
      date TEXT PRIMARY KEY,
      answers INTEGER NOT NULL,
      queries INTEGER NOT NULL,
      cited INTEGER NOT NULL,
      distinct_cited INTEGER NOT NULL,
      mossland_cited INTEGER NOT NULL,
      errors INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

/** Record (or overwrite) one day's audit summary. */
export function recordAuditRun(run: Omit<AuditRun, "createdAt">): void {
  ensureTable();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO alpha_audit_runs
         (date, answers, queries, cited, distinct_cited, mossland_cited, errors, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.date,
      run.answers,
      run.queries,
      run.cited,
      run.distinctCited,
      run.mosslandCited,
      run.errors,
      new Date().toISOString()
    );
}

/** Most recent runs, newest first. */
export function recentAuditRuns(limit = 8): AuditRun[] {
  ensureTable();
  const rows = getDb()
    .prepare(
      `SELECT date, answers, queries, cited, distinct_cited, mossland_cited,
              errors, created_at
       FROM alpha_audit_runs ORDER BY date DESC LIMIT ?`
    )
    .all(limit) as {
    date: string;
    answers: number;
    queries: number;
    cited: number;
    distinct_cited: number;
    mossland_cited: number;
    errors: number;
    created_at: string;
  }[];
  return rows.map((r) => ({
    date: r.date,
    answers: r.answers,
    queries: r.queries,
    cited: r.cited,
    distinctCited: r.distinct_cited,
    mosslandCited: r.mossland_cited,
    errors: r.errors,
    createdAt: r.created_at,
  }));
}
