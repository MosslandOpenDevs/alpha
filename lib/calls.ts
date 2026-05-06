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
import { coingeckoIdFor, getCurrentPrice, getHistoricalPrice } from "./coingecko";

export type Direction = "up" | "down";
export type ResolutionStatus = "pending" | "correct" | "wrong" | "flat";

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
  author_kind: string;
  author_handle: string;
  stance: string | null;
  created_at: string;
}): Promise<TrackableCall | null> {
  ensureTable();

  // 자산 entity여야 함
  if (post.ref_type !== "asset" || !post.ref_id) return null;
  // stance가 있어야 함 (observe 제외)
  if (!post.stance || post.stance === "observe" || post.stance === "neutral")
    return null;
  // 이미 있으면 skip
  const existing = getDb()
    .prepare(`SELECT id FROM alpha_trackable_calls WHERE post_id = ?`)
    .get(post.id);
  if (existing) return null;

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

export type HandleStats = {
  handle: string;
  total: number;
  correct: number;
  wrong: number;
  flat: number;
  pending: number;
  accuracy: number; // correct / (correct + wrong) %
};

export function getHandleStats(handle: string): HandleStats {
  ensureTable();
  const rows = getDb()
    .prepare(
      `SELECT resolution_status, COUNT(*) as cnt FROM alpha_trackable_calls
       WHERE author_handle = ? GROUP BY resolution_status`
    )
    .all(handle) as { resolution_status: ResolutionStatus; cnt: number }[];

  const stats = { correct: 0, wrong: 0, flat: 0, pending: 0 };
  for (const r of rows) {
    if (r.resolution_status in stats) {
      (stats as Record<string, number>)[r.resolution_status] = r.cnt;
    }
  }
  const total = stats.correct + stats.wrong + stats.flat + stats.pending;
  const decided = stats.correct + stats.wrong;
  const accuracy = decided === 0 ? 0 : (stats.correct / decided) * 100;
  return {
    handle,
    total,
    correct: stats.correct,
    wrong: stats.wrong,
    flat: stats.flat,
    pending: stats.pending,
    accuracy,
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
  const now = new Date().toISOString();
  return getDb()
    .prepare(
      `SELECT * FROM alpha_trackable_calls
       WHERE resolution_status = 'pending' AND target_date < ?`
    )
    .all(now) as TrackableCall[];
}

export function getCallForPost(postId: string): TrackableCall | null {
  ensureTable();
  const row = getDb()
    .prepare(`SELECT * FROM alpha_trackable_calls WHERE post_id = ?`)
    .get(postId) as TrackableCall | undefined;
  return row || null;
}
