/**
 * Rate limit + global cost ceiling for paid-API endpoints.
 *
 * Protects /api/ask and /api/mcp ask_alpha from abuse that would burn
 * through Grok / OpenAI quotas. Two layers:
 *   1) Per-IP token bucket — short-burst limit (per minute) + daily cap
 *   2) Global daily cost ceiling — hard stop if total LLM spend > $X/day
 *
 * Storage: SQLite. Same DB as everything else, no Redis dependency.
 */

import crypto from "node:crypto";
import { getDb } from "./db";

const KST_OFFSET_MS = 9 * 3600_000;

let _tablesEnsured = false;

function ensureTables() {
  if (_tablesEnsured) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS alpha_api_rate_limit (
      ip_hash TEXT NOT NULL,
      route TEXT NOT NULL,
      bucket TEXT NOT NULL,         -- minute or day bucket label
      bucket_kind TEXT NOT NULL,    -- 'minute' | 'day'
      count INTEGER NOT NULL DEFAULT 0,
      first_at TEXT NOT NULL,
      PRIMARY KEY (ip_hash, route, bucket_kind, bucket)
    );
    CREATE INDEX IF NOT EXISTS idx_alpha_api_rate_limit_first
      ON alpha_api_rate_limit(first_at);

    CREATE TABLE IF NOT EXISTS alpha_api_cost_daily (
      day_kst TEXT PRIMARY KEY,     -- YYYY-MM-DD in KST
      cost_usd REAL NOT NULL DEFAULT 0,
      call_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  _tablesEnsured = true;
}

// Opportunistic pruning of stale rate-limit buckets so the tables don't grow
// forever (every distinct IP/minute mints a row). Throttled to once per hour
// per process; the buckets are only meaningful for the current minute/day.
let _lastPruneMs = 0;
function maybePruneOldBuckets() {
  const now = Date.now();
  if (now - _lastPruneMs < 3600_000) return;
  _lastPruneMs = now;
  const cutoff = new Date(now - 2 * 24 * 3600_000).toISOString();
  const cutoffHour = new Date(now - 2 * 24 * 3600_000).toISOString().slice(0, 13);
  try {
    const db = getDb();
    db.prepare(`DELETE FROM alpha_api_rate_limit WHERE first_at < ?`).run(cutoff);
    db.prepare(`DELETE FROM alpha_post_rate_limit WHERE bucket_hour < ?`).run(
      cutoffHour
    );
  } catch {
    // pruning is best-effort; never fail a request over it
  }
}

/** Anonymize IP for storage. */
function ipHash(ip: string): string {
  return crypto.createHash("sha256").update("alpha:rl:").update(ip).digest("hex").slice(0, 16);
}

/**
 * Extract client IP from a Request.
 *
 * X-Forwarded-For is `client, proxy1, proxy2, …`. The LEFTMOST entry is
 * fully attacker-controllable (anyone can send the header), so trusting it
 * lets a caller mint a fresh rate-limit bucket per request. Instead we count
 * `TRUSTED_PROXY_HOPS` proxies in from the RIGHT — the right end is appended
 * by our own infrastructure and cannot be forged past the nearest trusted
 * proxy. Default 0 → the IP our nearest trusted proxy actually connected
 * from (safer than the spoofable leftmost). Set it to the number of proxies
 * in front of the app (e.g. 1 when behind a CDN → reverse proxy).
 */
export function clientIp(req: Request): string {
  const hops = Math.max(
    0,
    Number.parseInt(process.env.TRUSTED_PROXY_HOPS || "0", 10) || 0
  );
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const idx = parts.length - 1 - hops;
      return parts[idx >= 0 ? idx : 0];
    }
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

function todayKstDate(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function thisMinuteKst(): string {
  const d = new Date(Date.now() + KST_OFFSET_MS).toISOString();
  return d.slice(0, 16); // YYYY-MM-DDTHH:MM
}

export type RateLimitVerdict =
  | { ok: true }
  | { ok: false; reason: "per_minute" | "per_day" | "global_cost"; retryAfterSec: number };

export type RateConfig = {
  perMinute: number;
  perDay: number;
  /** route key for storage (e.g., "ask", "mcp_ask_alpha") */
  route: string;
};

/** Default per-IP limits for paid-API endpoints. */
export const RL_ASK: RateConfig = { route: "ask", perMinute: 5, perDay: 50 };
export const RL_MCP_ASK: RateConfig = { route: "mcp_ask_alpha", perMinute: 10, perDay: 100 };

/** Global daily Grok+OpenAI spend ceiling (USD). 503 above this. */
export const GLOBAL_DAILY_COST_CAP_USD = 5.0;

function incrementBucket(args: {
  ipHash: string;
  route: string;
  bucket: string;
  bucketKind: "minute" | "day";
}): number {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO alpha_api_rate_limit (ip_hash, route, bucket, bucket_kind, count, first_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(ip_hash, route, bucket_kind, bucket)
     DO UPDATE SET count = count + 1`
  ).run(args.ipHash, args.route, args.bucket, args.bucketKind, now);
  const row = db.prepare(
    `SELECT count FROM alpha_api_rate_limit
     WHERE ip_hash = ? AND route = ? AND bucket_kind = ? AND bucket = ?`
  ).get(args.ipHash, args.route, args.bucketKind, args.bucket) as { count: number };
  return row.count;
}

/** Get today's accumulated cost (USD) without mutating it. */
export function todayCostUsd(): { day: string; costUsd: number; callCount: number } {
  ensureTables();
  const day = todayKstDate();
  const row = getDb()
    .prepare(`SELECT cost_usd, call_count FROM alpha_api_cost_daily WHERE day_kst = ?`)
    .get(day) as { cost_usd: number; call_count: number } | undefined;
  return { day, costUsd: row?.cost_usd ?? 0, callCount: row?.call_count ?? 0 };
}

/** Add to today's cost counter (called after a paid API call). */
export function addCost(costUsd: number) {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  ensureTables();
  const day = todayKstDate();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO alpha_api_cost_daily (day_kst, cost_usd, call_count, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(day_kst) DO UPDATE SET
         cost_usd = cost_usd + excluded.cost_usd,
         call_count = call_count + 1,
         updated_at = excluded.updated_at`
    )
    .run(day, costUsd, now);
}

/** Check the per-IP + global cost ceilings BEFORE doing the paid call. */
export function checkRateLimit(req: Request, cfg: RateConfig): RateLimitVerdict {
  ensureTables();
  maybePruneOldBuckets();

  // 1. Global daily cost ceiling — applies to everyone, even fresh IPs
  const cost = todayCostUsd();
  if (cost.costUsd >= GLOBAL_DAILY_COST_CAP_USD) {
    // Until KST midnight
    const KST_OFFSET_MS = 9 * 3600_000;
    const tomorrowKstUtc =
      Date.parse(cost.day + "T00:00:00Z") - KST_OFFSET_MS + 24 * 3600_000;
    const retryAfterSec = Math.max(60, Math.ceil((tomorrowKstUtc - Date.now()) / 1000));
    return { ok: false, reason: "global_cost", retryAfterSec };
  }

  // 2. Per-IP buckets
  const ip = clientIp(req);
  const h = ipHash(ip);

  const minBucket = thisMinuteKst();
  const dayBucket = todayKstDate();

  const minCount = incrementBucket({
    ipHash: h,
    route: cfg.route,
    bucket: minBucket,
    bucketKind: "minute",
  });
  if (minCount > cfg.perMinute) {
    return { ok: false, reason: "per_minute", retryAfterSec: 60 };
  }

  const dayCount = incrementBucket({
    ipHash: h,
    route: cfg.route,
    bucket: dayBucket,
    bucketKind: "day",
  });
  if (dayCount > cfg.perDay) {
    // Until KST midnight
    const tomorrowKstUtc =
      Date.parse(dayBucket + "T00:00:00Z") - 9 * 3600_000 + 24 * 3600_000;
    const retryAfterSec = Math.max(60, Math.ceil((tomorrowKstUtc - Date.now()) / 1000));
    return { ok: false, reason: "per_day", retryAfterSec };
  }

  return { ok: true };
}

/** Build a 429 / 503 Response from a verdict. */
export function rateLimitResponse(
  verdict: Exclude<RateLimitVerdict, { ok: true }>,
  cors: Record<string, string>
): Response {
  const status = verdict.reason === "global_cost" ? 503 : 429;
  const body = {
    error: "rate_limited",
    reason: verdict.reason,
    retry_after_sec: verdict.retryAfterSec,
    ...(verdict.reason === "global_cost"
      ? { hint: "Daily LLM cost ceiling reached; resets at KST midnight." }
      : {}),
  };
  return Response.json(body, {
    status,
    headers: {
      ...cors,
      "Retry-After": String(verdict.retryAfterSec),
    },
  });
}

/** Snapshot for /health. */
export function rateLimitSnapshot(): {
  today: ReturnType<typeof todayCostUsd>;
  cap_usd: number;
} {
  return {
    today: todayCostUsd(),
    cap_usd: GLOBAL_DAILY_COST_CAP_USD,
  };
}
