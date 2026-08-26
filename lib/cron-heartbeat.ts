/**
 * Cron heartbeat — records the most recent cron attempt, including successful
 * no-op runs and explicit failures.
 *
 * Background: event-driven crons (alpha-why-moved-cron, alpha-calls-cron)
 * legitimately produce nothing on quiet days. Without a heartbeat the
 * /health page can't distinguish "cron didn't fire" from "cron fired and
 * had no work" — both look like stale content. Heartbeats fix that.
 */

import { getDb } from "./db";

export type HeartbeatStatus = "ok" | "noop" | "error";

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_cron_heartbeats (
      name TEXT PRIMARY KEY,
      last_run_at TEXT NOT NULL,
      last_status TEXT NOT NULL,
      last_note TEXT,
      run_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

/** Record one terminal status per cron attempt. status='noop' is a
 * successful run with no work; status='error' is a failed attempt. */
export function recordHeartbeat(
  name: string,
  status: HeartbeatStatus = "ok",
  note?: string
): void {
  ensureTable();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO alpha_cron_heartbeats (name, last_run_at, last_status, last_note, run_count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(name) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         last_status = excluded.last_status,
         last_note = excluded.last_note,
         run_count = run_count + 1`
    )
    .run(name, now, status, note ?? null);
}

export type Heartbeat = {
  name: string;
  lastRunAt: string;
  lastStatus: HeartbeatStatus;
  lastNote: string | null;
  runCount: number;
};

export function getHeartbeat(name: string): Heartbeat | null {
  ensureTable();
  const row = getDb()
    .prepare(
      `SELECT name, last_run_at, last_status, last_note, run_count
       FROM alpha_cron_heartbeats WHERE name = ?`
    )
    .get(name) as
    | {
        name: string;
        last_run_at: string;
        last_status: HeartbeatStatus;
        last_note: string | null;
        run_count: number;
      }
    | undefined;
  if (!row) return null;
  return {
    name: row.name,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    lastNote: row.last_note,
    runCount: row.run_count,
  };
}

export function getAllHeartbeats(): Heartbeat[] {
  ensureTable();
  const rows = getDb()
    .prepare(
      `SELECT name, last_run_at, last_status, last_note, run_count
       FROM alpha_cron_heartbeats ORDER BY last_run_at DESC`
    )
    .all() as {
      name: string;
      last_run_at: string;
      last_status: HeartbeatStatus;
      last_note: string | null;
      run_count: number;
    }[];
  return rows.map((r) => ({
    name: r.name,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastNote: r.last_note,
    runCount: r.run_count,
  }));
}

/**
 * Off-host state of the daily DB backup, carried inside its heartbeat note.
 *
 * The note itself is prose for whoever reads /health. This token is the one
 * part `lib/health.ts` parses, and it lives here — beside the contract it
 * rides on — so the writer and the reader cannot drift apart into two string
 * literals in two files.
 */
export type OffHostState = "none" | "ok" | "fail";

export function offHostToken(state: OffHostState): string {
  return `offhost=${state}`;
}

export function readOffHost(note: string | null | undefined): OffHostState | null {
  const m = /\boffhost=(none|ok|fail)\b/.exec(note ?? "");
  return m ? (m[1] as OffHostState) : null;
}
