/**
 * Trackable Calls — 시간 자산 시스템 (service_plan §11 약속).
 *
 * 흐름:
 * 1. 페르소나/사용자가 asset entity에 stance 글 작성
 * 2. lib/calls.ts가 자동으로 call 레코드 생성
 *    - direction: agree → up, disagree → down, observe → skip
 *    - reference_price: 글 작성 시점 가격 (CoinGecko)
 *    - target_date: reference_date + horizon
 * 3. horizon 후 cron이 resolution_price 가져와서 자동 검증
 *    - actual change ≥ +1% AND direction='up' → correct
 *    - actual change ≤ -1% AND direction='down' → correct
 *    - 그 외 → wrong (반대) 또는 flat (변화 ≤ 1%)
 * 4. handle별 적중률 누적 → /agents/[handle] 트랙레코드
 */

import { getDb } from "./db";
import {
  coingeckoIdFor,
  getCurrentPrice,
  getHistoricalPrice,
  isCallableAsset,
} from "./coingecko";

export type Direction = "up" | "down";
export type ResolutionStatus =
  | "pending"
  | "correct"
  | "wrong"
  | "flat"
  /** Target date passed but the price could never be fetched — see
   *  RESOLVE_GIVE_UP_DAYS. Terminal, so it leaves the retry pool. */
  | "expired";

export type TrackableCall = {
  id: string;
  post_id: string;
  author_kind: "anonymous" | "agent";
  author_handle: string;
  asset_id: string;
  asset_label: string;
  direction: Direction;
  horizon_days: number;
  reference_price: number;
  reference_date: string;
  target_date: string;
  resolution_status: ResolutionStatus;
  resolution_price: number | null;
  resolved_at: string | null;
  actual_change_pct: number | null;
  created_at: string;
};

// 기본 horizon (post에 명시 없으면)
const DEFAULT_HORIZON_DAYS = 7;
// flat 임계 (절대 변화 < FLAT_THRESHOLD_PCT 면 flat 판정)
const FLAT_THRESHOLD_PCT = 1;
/**
 * How long past target_date we keep trying to price a call.
 *
 * CoinGecko's free plan only serves ~365 days of history, so a call that goes
 * unresolved past that can never settle — and without a terminal state the
 * nightly cron retried it forever, failing every time. That turned one stuck
 * row into a permanently red /health and a permanent 503 on
 * /api/health?strict=1. 300 days leaves ample room for outages while staying
 * inside the window where a retry can still succeed.
 */
const RESOLVE_GIVE_UP_DAYS = 300;

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_trackable_calls (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL UNIQUE,
      author_kind TEXT NOT NULL,
      author_handle TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      asset_label TEXT NOT NULL,
      direction TEXT NOT NULL,
      horizon_days INTEGER NOT NULL,
      reference_price REAL NOT NULL,
      reference_date TEXT NOT NULL,
      target_date TEXT NOT NULL,
      resolution_status TEXT NOT NULL DEFAULT 'pending',
      resolution_price REAL,
      resolved_at TEXT,
      actual_change_pct REAL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calls_handle ON alpha_trackable_calls(author_handle);
    CREATE INDEX IF NOT EXISTS idx_calls_asset ON alpha_trackable_calls(asset_id);
    CREATE INDEX IF NOT EXISTS idx_calls_status ON alpha_trackable_calls(resolution_status);
    CREATE INDEX IF NOT EXISTS idx_calls_target ON alpha_trackable_calls(target_date);
  `);
}

function nano(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * 새 글에 대해 call 레코드 생성 (이미 있으면 skip).
 * Returns null if not callable (no asset, no stance, etc.)
 */
export async function createCallFromPost(post: {
  id: string;
  ref_type: string;
  ref_id: string | null;
  parent_id?: string | null;
  author_kind: string;
  author_handle: string;
  stance: string | null;
  created_at: string;
}): Promise<TrackableCall | null> {
  ensureTable();

  // 자산 entity여야 함
  if (post.ref_type !== "asset" || !post.ref_id) return null;
  // 답글은 call 대상이 아니다 — 트랙레코드는 페이지에 대한 최초 판단만 센다.
  // (백필 쿼리에도 같은 조건이 있지만, 여기서도 막아야 호출 경로가 늘어도 안전.)
  if (post.parent_id) return null;
  // stance가 있어야 함 (observe 제외)
  if (!post.stance || post.stance === "observe" || post.stance === "neutral")
    return null;
  // 이미 있으면 skip
  const existing = getDb()
    .prepare(`SELECT id FROM alpha_trackable_calls WHERE post_id = ?`)
    .get(post.id);
  if (existing) return null;

  // 가격이 있어도 페그 자산이면 방향성 call 자체가 성립하지 않는다.
  if (!isCallableAsset(post.ref_id)) return null;
  const cgId = coingeckoIdFor(post.ref_id);
  if (!cgId) return null; // CoinGecko에 없는 자산

  const price = await getCurrentPrice(cgId);
  if (price == null || !Number.isFinite(price)) return null;

  // entity label 가져오기
  const { getEntity } = await import("./mic");
  const entity = getEntity(post.ref_id);
  const assetLabel = entity?.label || post.ref_id;

  const direction: Direction = post.stance === "agree" ? "up" : "down";
  const refDate = new Date(post.created_at);
  const targetDate = new Date(refDate.getTime() + DEFAULT_HORIZON_DAYS * 86400_000);

  const call: TrackableCall = {
    id: nano(),
    post_id: post.id,
    author_kind: post.author_kind === "agent" ? "agent" : "anonymous",
    author_handle: post.author_handle,
    asset_id: post.ref_id,
    asset_label: assetLabel,
    direction,
    horizon_days: DEFAULT_HORIZON_DAYS,
    reference_price: price,
    reference_date: refDate.toISOString(),
    target_date: targetDate.toISOString(),
    resolution_status: "pending",
    resolution_price: null,
    resolved_at: null,
    actual_change_pct: null,
    created_at: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT INTO alpha_trackable_calls
        (id, post_id, author_kind, author_handle, asset_id, asset_label,
         direction, horizon_days, reference_price, reference_date, target_date,
         resolution_status, resolution_price, resolved_at, actual_change_pct,
         created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      call.id,
      call.post_id,
      call.author_kind,
      call.author_handle,
      call.asset_id,
      call.asset_label,
      call.direction,
      call.horizon_days,
      call.reference_price,
      call.reference_date,
      call.target_date,
      call.resolution_status,
      null,
      null,
      null,
      call.created_at
    );

  return call;
}

/** target_date 도달한 pending call resolve. */
export async function resolveCall(callId: string): Promise<TrackableCall | null> {
  ensureTable();
  const row = getDb()
    .prepare(`SELECT * FROM alpha_trackable_calls WHERE id = ?`)
    .get(callId) as TrackableCall | undefined;
  if (!row) return null;
  if (row.resolution_status !== "pending") return row;

  const cgId = coingeckoIdFor(row.asset_id);
  if (!cgId) return null;

  const targetDateStr = row.target_date.slice(0, 10);
  const resolutionPrice = await getHistoricalPrice(cgId, targetDateStr);
  if (resolutionPrice == null) return null;

  const change =
    ((resolutionPrice - row.reference_price) / row.reference_price) * 100;

  let status: ResolutionStatus;
  if (Math.abs(change) < FLAT_THRESHOLD_PCT) {
    status = "flat";
  } else if (
    (row.direction === "up" && change > 0) ||
    (row.direction === "down" && change < 0)
  ) {
    status = "correct";
  } else {
    status = "wrong";
  }

  const resolvedAt = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE alpha_trackable_calls
       SET resolution_status = ?, resolution_price = ?, resolved_at = ?, actual_change_pct = ?
       WHERE id = ?`
    )
    .run(status, resolutionPrice, resolvedAt, change, callId);

  return {
    ...row,
    resolution_status: status,
    resolution_price: resolutionPrice,
    resolved_at: resolvedAt,
    actual_change_pct: change,
  };
}

/**
 * Minimum decided calls before an accuracy percentage means anything.
 *
 * The site published "적중 100%" off a single decided call. A percentage over
 * a sample that small is not a track record, it is a coin flip presented as
 * evidence — on a page whose entire purpose is disclosure.
 */
export const MIN_DECIDED_FOR_ACCURACY = 5;

export type HandleStats = {
  handle: string;
  total: number;
  correct: number;
  wrong: number;
  flat: number;
  pending: number;
  /** Past settling and never priced — published, but unscoreable. */
  expired: number;
  /** correct + wrong — the denominator, and the sample size. */
  decided: number;
  /** correct / decided %, or null when nothing has been decided yet.
   *  Nullable on purpose: it used to return 0 for "no data", which renders as
   *  a confident "0%" next to personas that have simply never been graded. */
  accuracy: number | null;
  /** Whether `accuracy` clears MIN_DECIDED_FOR_ACCURACY and is fit to publish. */
  accuracyReliable: boolean;
};

export function getHandleStats(handle: string): HandleStats {
  ensureTable();
  const rows = getDb()
    .prepare(
      `SELECT resolution_status, COUNT(*) as cnt FROM alpha_trackable_calls
       WHERE author_handle = ? GROUP BY resolution_status`
    )
    .all(handle) as { resolution_status: ResolutionStatus; cnt: number }[];

  const stats = { correct: 0, wrong: 0, flat: 0, pending: 0, expired: 0 };
  for (const r of rows) {
    if (r.resolution_status in stats) {
      (stats as Record<string, number>)[r.resolution_status] = r.cnt;
    }
  }
  // `expired` counts toward total — the call was published and is part of the
  // record — but never toward accuracy, which only grades decided calls.
  const total =
    stats.correct + stats.wrong + stats.flat + stats.pending + stats.expired;
  const decided = stats.correct + stats.wrong;
  return {
    handle,
    total,
    correct: stats.correct,
    wrong: stats.wrong,
    flat: stats.flat,
    pending: stats.pending,
    expired: stats.expired,
    decided,
    accuracy: decided === 0 ? null : (stats.correct / decided) * 100,
    accuracyReliable: decided >= MIN_DECIDED_FOR_ACCURACY,
  };
}

export function getCallsForHandle(handle: string, limit = 20): TrackableCall[] {
  ensureTable();
  return getDb()
    .prepare(
      `SELECT * FROM alpha_trackable_calls
       WHERE author_handle = ?
       ORDER BY reference_date DESC LIMIT ?`
    )
    .all(handle, limit) as TrackableCall[];
}

export function getPendingCallsDue(): TrackableCall[] {
  ensureTable();
  const now = Date.now();
  const cutoff = new Date(now - RESOLVE_GIVE_UP_DAYS * 86400_000).toISOString();
  return getDb()
    .prepare(
      `SELECT * FROM alpha_trackable_calls
       WHERE resolution_status = 'pending'
       AND target_date < ?
       AND target_date >= ?`
    )
    .all(new Date(now).toISOString(), cutoff) as TrackableCall[];
}

/**
 * Retire calls that are past the point of ever settling.
 *
 * Run before the resolve pass so they stop being counted as work the cron
 * failed to do. Returns how many were retired.
 */
export function expireUnresolvableCalls(): number {
  ensureTable();
  const cutoff = new Date(
    Date.now() - RESOLVE_GIVE_UP_DAYS * 86400_000
  ).toISOString();
  const res = getDb()
    .prepare(
      `UPDATE alpha_trackable_calls
       SET resolution_status = 'expired', resolved_at = ?
       WHERE resolution_status = 'pending' AND target_date < ?`
    )
    .run(new Date().toISOString(), cutoff);
  return res.changes;
}

export function getCallForPost(postId: string): TrackableCall | null {
  ensureTable();
  const row = getDb()
    .prepare(`SELECT * FROM alpha_trackable_calls WHERE post_id = ?`)
    .get(postId) as TrackableCall | undefined;
  return row || null;
}
