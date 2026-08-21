/**
 * Trackable Calls — 시간 자산 시스템 (service_plan §11 약속).
 *
 * 흐름:
 * 1. 페르소나/사용자가 asset entity에 stance 글 작성
 * 2. 글과 **같은 transaction 안에서** call 레코드 생성 (lib/persona-post.ts).
 *    글만 남고 call 이 없는 상태는 /agents 가 지키지 못하는 약속이므로,
 *    reference price 는 글을 쓰기 전에 확보한다.
 *    - direction: agree → up, disagree → down, observe → skip
 *    - reference_price: 글 작성 시점 가격 (lib/prices.ts — 코인이면
 *      CoinGecko, 지수·원자재면 Yahoo)
 *    - target_date: reference_date + horizon
 *    - flat_pct: 그 시점의 보합 폭을 행에 기록 (자산군별로 다름)
 * 3. horizon 후 cron이 resolution_price 가져와서 자동 검증
 *    - |변화| < flat_pct → flat
 *    - 방향 일치 → correct, 불일치 → wrong
 * 4. handle별 적중률 누적 → /agents/[handle] 트랙레코드
 */

import {
  createPost,
  ensureCommunityTables,
  type CreatePostArgs,
  type Post,
} from "./community";
import { getDb } from "./db";
import { getAssetOrStub } from "./mic";
import { currentPrice, flatPctFor, isCallableAsset, marketFor, priceOn } from "./prices";

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
  /** 보합 판정 폭(%). 발행 시점의 규칙을 행이 스스로 설명한다. */
  flat_pct: number;
  resolution_status: ResolutionStatus;
  resolution_price: number | null;
  resolved_at: string | null;
  actual_change_pct: number | null;
  created_at: string;
};

// 기본 horizon (post에 명시 없으면)
const DEFAULT_HORIZON_DAYS = 7;
/**
 * 보합 폭의 기본값. 실제 폭은 자산군별로 다르고 (lib/prices.ts) call 생성
 * 시점에 행에 기록된다 — 폭을 나중에 바꿔도 이미 발행된 기록이 조용히
 * 재채점되지 않게 하기 위해서다. 이 상수는 그 컬럼이 없던 시절에 만들어진
 * 행들이 실제로 채점받았던 값이기도 하다.
 */
const LEGACY_FLAT_PCT = 1;
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
/**
 * How long after target_date a call becomes due for settlement.
 *
 * Exchange-traded assets settle on the close of the target date's session,
 * and that session must be over before it can be read. Without a delay the
 * 13:00 KST cron reached a US index call on its target date at 04:00 UTC —
 * hours before that day's open — and settled it on the PREVIOUS session's
 * close; had that run failed, the retry a day later would have used the
 * target day's close instead. Same call, two prices, decided by whether a
 * cron tick succeeded. KOSPI was worse: mid-session print vs close.
 *
 * A full day clears every mapped market's close (the latest is 21:00 UTC),
 * so the first eligible run always sees the same finished bar. Coin prices
 * come from CoinGecko's 00:00 UTC snapshot and were already deterministic;
 * they just settle one run later than before.
 */
const SETTLE_DELAY_MS = 24 * 3600_000;

function ensureTable() {
  const db = getDb();
  db.exec(`
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
      flat_pct REAL NOT NULL DEFAULT ${LEGACY_FLAT_PCT},
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

  // Existing databases predate flat_pct. The default backfills every row with
  // 1, which is exactly the band those calls were graded under, so the
  // published record stays true.
  const cols = db
    .prepare(`PRAGMA table_info(alpha_trackable_calls)`)
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "flat_pct")) {
    try {
      db.exec(
        `ALTER TABLE alpha_trackable_calls ADD COLUMN flat_pct REAL NOT NULL DEFAULT ${LEGACY_FLAT_PCT}`
      );
    } catch (err) {
      // The web process and the cron can reach this concurrently; losing the
      // race is fine, the column exists either way.
      if (!/duplicate column name/i.test(String(err))) throw err;
    }
  }
}

function nano(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** The subset of a post a call is built from. */
export type CallSource = {
  id: string;
  ref_type: string;
  ref_id: string | null;
  parent_id?: string | null;
  author_kind: string;
  author_handle: string;
  stance: string | null;
  created_at: string;
};

/** Create the table from outside, so a caller can do it before opening a
 *  transaction rather than running DDL inside one. */
export function ensureCallsTable(): void {
  ensureTable();
}

/**
 * Can this post carry a call, and in which direction? No network, no writes.
 *
 * Split out from the insert so a caller can ask the question *before* it
 * spends money generating the post — lib/persona-post.ts fetches the
 * reference price up front on the strength of this answer.
 */
export function callDirectionFor(post: CallSource): Direction | null {
  // 자산 entity여야 함
  if (post.ref_type !== "asset" || !post.ref_id) return null;
  // 답글은 call 대상이 아니다 — 트랙레코드는 페이지에 대한 최초 판단만 센다.
  // (백필 쿼리에도 같은 조건이 있지만, 여기서도 막아야 호출 경로가 늘어도 안전.)
  if (post.parent_id) return null;
  // stance가 있어야 함 (observe 제외)
  if (post.stance !== "agree" && post.stance !== "disagree") return null;
  // 가격 출처가 없거나, 있어도 페그 자산이면 방향성 call 이 성립하지 않는다.
  // (isCallableAsset 이 두 조건을 모두 본다.)
  if (!isCallableAsset(post.ref_id)) return null;
  return post.stance === "agree" ? "up" : "down";
}

/**
 * Write the call for a post whose reference price is already in hand.
 *
 * Synchronous on purpose. better-sqlite3 transactions cannot await, and the
 * only way a stance post and its call are guaranteed to exist together is to
 * write them in one — see lib/persona-post.ts.
 *
 * Throws on an unusable price: by the time we are here the caller has claimed
 * to have one, and silently dropping the call is the failure mode this split
 * exists to remove.
 */
export function insertCallForPost(
  post: CallSource,
  referencePrice: number
): TrackableCall | null {
  ensureTable();
  const direction = callDirectionFor(post);
  if (!direction) return null;
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    throw new Error(
      `unusable reference price for ${post.ref_id}: ${referencePrice}`
    );
  }
  // 이미 있으면 skip
  const existing = getDb()
    .prepare(`SELECT id FROM alpha_trackable_calls WHERE post_id = ?`)
    .get(post.id);
  if (existing) return null;

  const assetId = post.ref_id as string;
  // getAssetOrStub, not getEntity: getAllEntities() reads the canonical store
  // only, so an asset that lives as a stub (ethereum was one) resolves to null
  // and the published call would carry the raw id — "ethereum" where the page
  // says 이더리움.
  const entity = getAssetOrStub(assetId);
  const assetLabel = entity?.label || assetId;

  const price = referencePrice;
  const refDate = new Date(post.created_at);
  const targetDate = new Date(refDate.getTime() + DEFAULT_HORIZON_DAYS * 86400_000);

  const call: TrackableCall = {
    id: nano(),
    post_id: post.id,
    author_kind: post.author_kind === "agent" ? "agent" : "anonymous",
    author_handle: post.author_handle,
    asset_id: assetId,
    asset_label: assetLabel,
    direction,
    horizon_days: DEFAULT_HORIZON_DAYS,
    reference_price: price,
    reference_date: refDate.toISOString(),
    target_date: targetDate.toISOString(),
    flat_pct: flatPctFor(assetId),
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
         flat_pct, resolution_status, resolution_price, resolved_at,
         actual_change_pct, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      call.flat_pct,
      call.resolution_status,
      null,
      null,
      null,
      call.created_at
    );

  return call;
}

/**
 * 글과 call 을 한 transaction 으로 쓴다 — 트랙레코드의 유일한 무결성 보장.
 *
 * A stance on a priceable asset IS a call: /agents publishes the record built
 * from them, so a post that exists without its call is a promise the site
 * cannot keep. Pass the reference price you already fetched (see
 * lib/persona-post.ts, which fetches it before the model call) and both rows
 * land together or neither does.
 *
 * `referencePrice` null means "this was never going to carry a call" — an
 * unpriceable page, a dry stance — and the post is written on its own.
 * insertCallForPost re-checks stance, asset and duplication, so the caller
 * does not repeat those conditions and they cannot drift apart.
 */
export function createPostWithCall(
  args: CreatePostArgs,
  referencePrice: number | null
): Post {
  ensureCommunityTables();
  ensureTable();
  return getDb().transaction(() => {
    const post = createPost(args);
    if (referencePrice != null) insertCallForPost(post, referencePrice);
    return post;
  })();
}

/**
 * 새 글에 대해 call 레코드 생성 (이미 있으면 skip).
 * Returns null if not callable (no asset, no stance, no price, …).
 *
 * The price is fetched here, so post and call cannot be written together.
 * That is fine for the backfill path (scripts/track-calls.ts), which is
 * recovering posts that already exist. A writer creating the post right now
 * should pre-fetch the price and use insertCallForPost() inside its own
 * transaction instead.
 */
export async function createCallFromPost(
  post: CallSource
): Promise<TrackableCall | null> {
  if (!callDirectionFor(post)) return null;
  const price = await currentPrice(post.ref_id as string);
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  return insertCallForPost(post, price);
}

/** target_date 도달한 pending call resolve. */
export async function resolveCall(callId: string): Promise<TrackableCall | null> {
  ensureTable();
  const row = getDb()
    .prepare(`SELECT * FROM alpha_trackable_calls WHERE id = ?`)
    .get(callId) as TrackableCall | undefined;
  if (!row) return null;
  if (row.resolution_status !== "pending") return row;

  // Resolve still works for pegged assets: they cannot receive NEW calls, but
  // ones already on record have to keep settling.
  if (!marketFor(row.asset_id)) return null;

  const targetDateStr = row.target_date.slice(0, 10);
  const resolutionPrice = await priceOn(row.asset_id, targetDateStr);
  if (resolutionPrice == null) return null;

  const change =
    ((resolutionPrice - row.reference_price) / row.reference_price) * 100;

  // The band the call was PUBLISHED under, not today's — an older row grades
  // by the rule it was issued with.
  const flatPct = Number.isFinite(row.flat_pct) ? row.flat_pct : LEGACY_FLAT_PCT;

  let status: ResolutionStatus;
  if (Math.abs(change) < flatPct) {
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
  const due = new Date(now - SETTLE_DELAY_MS).toISOString();
  const cutoff = new Date(now - RESOLVE_GIVE_UP_DAYS * 86400_000).toISOString();
  return getDb()
    .prepare(
      `SELECT * FROM alpha_trackable_calls
       WHERE resolution_status = 'pending'
       AND target_date < ?
       AND target_date >= ?`
    )
    .all(due, cutoff) as TrackableCall[];
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
