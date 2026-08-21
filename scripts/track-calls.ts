/**
 * Trackable calls 일일 cron — 두 단계:
 *
 * Phase 1: backfill — call 레코드가 없는 *최근* post 복구 (MAX_BACKFILL_AGE_MINUTES).
 *          reference price 는 실행 시점 spot 이라 그 이상 오래된 post 는 복구하지
 *          않는다. 운영 cron 은 `--skip-backfill` 로 이 단계를 아예 건너뛴다.
 * Phase 2: resolve — target_date 지난 pending call 자동 해결
 *
 * 사용법:
 *   pnpm tsx scripts/track-calls.ts            # 두 단계 모두
 *   pnpm tsx scripts/track-calls.ts --skip-backfill
 *   pnpm tsx scripts/track-calls.ts --skip-resolve
 *
 * pm2 cron: 매일 04:00 UTC = 13:00 KST.
 */

import path from "node:path";
import { loadScriptEnv } from "../lib/script-env";

loadScriptEnv();

// Reference prices are spot prices fetched when this script runs, so a post
// can only be recovered here while it is minutes old; otherwise it would be
// scored against a price that never existed at publication time.
//
// Only lib/persona-post.ts creates a call at write time. Anonymous community
// posts and persona replies never produce calls — that is intentional, not a
// gap this window is meant to cover, and the query below enforces it with
// `parent_id IS NULL` (it previously did not, so three of the four published
// calls came from replies). Historical calls need an explicit time-series
// backfill, not this spot-price path.
const MAX_BACKFILL_AGE_MINUTES = 15;

/** What the run actually accomplished — the heartbeat is derived from this,
 *  not from "the process exited zero". */
type RunTally = {
  backfillCandidates: number;
  created: number;
  backfillFailed: number;
  resolveDue: number;
  resolved: number;
  resolveFailed: number;
  resolveUnmapped: number;
  /** Retired as unresolvable this run. */
  expired: number;
};

function summarize(t: RunTally, skipBackfill: boolean, skipResolve: boolean): string {
  return (
    `skipBackfill=${skipBackfill} skipResolve=${skipResolve} ` +
    `candidates=${t.backfillCandidates} created=${t.created} backfill_failed=${t.backfillFailed} ` +
    `due=${t.resolveDue} resolved=${t.resolved} resolve_failed=${t.resolveFailed} ` +
    `unmapped=${t.resolveUnmapped} expired=${t.expired}`
  );
}

/**
 * Grade the run.
 *
 * `ok` means work was done, `noop` means there was legitimately nothing to do,
 * `error` means work was available and did not get done. The old code recorded
 * a flat "ok" whenever the process exited zero, which is why /health showed
 * trackable_calls green through 95 days of producing nothing.
 */
function gradeRun(t: RunTally): { status: "ok" | "noop" | "error"; reason: string } {
  // `error` is reserved for "nothing got through", because lib/health.ts turns
  // it straight into a red subsystem and /api/health?strict=1 answers 503 —
  // documented for uptime monitors. CoinGecko's free tier allows 30 req/min
  // and this script paces at ~27, so an occasional 429 (surfaced as a null
  // from resolveCall) is ordinary operation, not an outage. Grading a single
  // one as fatal would replace the false green this change set removed with a
  // false red that pages someone at 4am.
  const attempted = t.backfillCandidates + t.resolveDue;
  const succeeded = t.created + t.resolved;
  const failed = t.backfillFailed + t.resolveFailed;

  // On a normal day the production cron (--skip-backfill) has a handful of
  // due calls, often one. "0 succeeded, 1 failed" is a single CoinGecko 429,
  // not an outage, so requiring a minimum sample keeps the earlier reasoning
  // intact instead of undoing it at n=1.
  const MIN_ATTEMPTS_TO_FAIL = 3;
  if (attempted === 0) {
    return { status: "noop", reason: "처리할 대상 없음" };
  }
  if (succeeded === 0 && failed > 0) {
    if (attempted < MIN_ATTEMPTS_TO_FAIL) {
      return {
        status: "ok",
        reason: `대상 ${attempted}건이 모두 실패했으나 표본이 작아 일시적 오류로 간주 (다음 실행 재시도)`,
      };
    }
    return { status: "error", reason: "대상이 있었으나 한 건도 처리하지 못함" };
  }
  if (failed > 0) {
    return {
      status: "ok",
      reason: `부분 실패 ${failed}건 (일시적 가격 조회 실패로 간주, 다음 실행에서 재시도)`,
    };
  }
  if (succeeded === 0) {
    // Everything was skipped — unmapped assets, pegged assets, already-priced
    // posts. Legitimate quiet, not a failure.
    return { status: "noop", reason: "대상이 모두 skip 조건에 해당" };
  }
  return { status: "ok", reason: "정상 처리" };
}

/** Intended KST hour of the pm2 cron (13:00 KST = 04:00 UTC). */
const SCHEDULED_KST_HOUR = 13;

async function main() {
  const args = process.argv.slice(2);
  const skipBackfill = args.includes("--skip-backfill");
  const skipResolve = args.includes("--skip-resolve");

  // This cron now writes a terminal state (expireUnresolvableCalls), so a pm2
  // re-registration at deploy time would mutate rows at an arbitrary hour.
  const { scheduledSkipReason } = await import("../lib/kst");
  const skip = scheduledSkipReason(args, SCHEDULED_KST_HOUR);
  if (skip) {
    console.log(skip);
    return;
  }

  const tally: RunTally = {
    backfillCandidates: 0,
    created: 0,
    backfillFailed: 0,
    resolveDue: 0,
    resolved: 0,
    resolveFailed: 0,
    resolveUnmapped: 0,
    expired: 0,
  };

  const { createCallFromPost, resolveCall, getPendingCallsDue, expireUnresolvableCalls } =
    await import("../lib/calls");
  const { isCallableAsset, marketFor, formatPrice } = await import("../lib/prices");
  const { getDb } = await import("../lib/db");

  // Trigger table creation by calling getHandleStats once
  const { getHandleStats } = await import("../lib/calls");
  getHandleStats("__init__");
  // Also ensure community tables (for posts join)
  const { ensureCommunityTables } = await import("../lib/community");
  ensureCommunityTables();

  // One shared connection. A second hand-built `new Database(DB_PATH,
  // {readonly:true})` threw "In-memory/temporary databases cannot be
  // readonly" whenever DB_PATH was unset (lib/db.ts falls back to
  // data/alpha-dev.sqlite; this did not), and then wrote an `error`
  // heartbeat for the run into that dev DB.
  const dbReadonly = getDb();

  // === Phase 1: backfill ===
  if (!skipBackfill) {
    // asset post 중 stance가 있는 것 + 아직 call 없는 것
    const candidates = dbReadonly
      .prepare(
        `SELECT p.id, p.ref_type, p.ref_id, p.author_kind, p.author_handle,
                p.stance, p.created_at
         FROM alpha_posts p
         LEFT JOIN alpha_trackable_calls c ON c.post_id = p.id
         WHERE p.ref_type = 'asset'
         AND p.parent_id IS NULL
         AND p.stance IS NOT NULL
         AND p.stance != 'observe'
         AND p.is_deleted = 0
         AND c.id IS NULL
         AND julianday(p.created_at) >= julianday('now', '-${MAX_BACKFILL_AGE_MINUTES} minutes')
         ORDER BY p.created_at DESC LIMIT 100`
      )
      .all() as Array<{
      id: string;
      ref_type: string;
      ref_id: string | null;
      author_kind: string;
      author_handle: string;
      stance: string | null;
      created_at: string;
    }>;

    console.log(`Backfill: ${candidates.length} candidate posts`);
    tally.backfillCandidates = candidates.length;
    let created = 0;
    let skipped = 0;
    let unmapped = 0;
    for (const post of candidates) {
      // Callability, not just priceability — a pegged asset would only ever
      // resolve flat. Resolve (Phase 2) goes through lib/prices.ts directly so
      // calls already on record keep settling.
      if (!post.ref_id || !isCallableAsset(post.ref_id)) {
        skipped++;
        unmapped++;
        continue;
      }
      try {
        const call = await createCallFromPost(post);
        if (call) {
          created++;
          process.stdout.write(
            `  ✓ ${call.asset_id} ${call.direction} @${post.author_handle} → ref ${formatPrice(call.asset_id, call.reference_price)}\n`
          );
        } else {
          skipped++;
        }
      } catch (err) {
        tally.backfillFailed++;
        console.error(`  ✗ ${post.id}: ${(err as Error).message}`);
      }
      // Rate-limit safety (CoinGecko free tier = 30 req/min)
      await new Promise((r) => setTimeout(r, 2200));
    }
    tally.created = created;
    console.log(
      `Backfill done. Created ${created}, skipped ${skipped} (${unmapped} unmapped).\n`
    );
  }

  // === Phase 2: resolve ===
  if (!skipResolve) {
    // Retire calls that can never settle first, so they stop being counted as
    // work this run failed to do (and stop reddening /health forever).
    const expired = expireUnresolvableCalls();
    if (expired > 0) {
      tally.expired = expired;
      console.log(`Expired ${expired} call(s) past the resolvable window.`);
    }
    const due = getPendingCallsDue();
    console.log(`Resolve: ${due.length} pending calls past target_date`);
    tally.resolveDue = due.length;
    let resolved = 0;
    for (const call of due) {
      // marketFor, not isCallableAsset: a pegged asset can no longer receive
      // new calls but the ones already published still have to settle.
      if (!marketFor(call.asset_id)) {
        tally.resolveUnmapped++;
        console.warn(`  - ${call.id}: no price source for ${call.asset_id}`);
        continue;
      }
      try {
        const r = await resolveCall(call.id);
        // null means the historical price lookup failed — a real failure that
        // used to vanish, since resolveCall reports it by returning null
        // rather than throwing.
        if (r == null) {
          tally.resolveFailed++;
          console.error(`  ✗ ${call.id}: no historical price for ${call.asset_id}`);
        } else if (r.resolution_status !== "pending") {
          resolved++;
          const sign = r.actual_change_pct! > 0 ? "+" : "";
          process.stdout.write(
            `  ✓ ${call.author_handle} ${call.asset_id} ${call.direction}: ${r.resolution_status} (${sign}${r.actual_change_pct!.toFixed(2)}%)\n`
          );
        }
      } catch (err) {
        tally.resolveFailed++;
        console.error(`  ✗ ${call.id}: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 2200));
    }
    tally.resolved = resolved;
    console.log(`Resolve done. ${resolved}/${due.length} resolved.\n`);
  }

  // (shared handle — nothing to close)

  const { status, reason } = gradeRun(tally);
  const summary = `${reason}. ${summarize(tally, skipBackfill, skipResolve)}`;
  console.log(`Heartbeat: ${status} — ${summary}`);

  const { recordHeartbeat } = await import("../lib/cron-heartbeat");
  recordHeartbeat("alpha-calls-cron", status, summary);
}

main().catch(async (err) => {
  // Fail closed. Without this a crash left the previous "ok" heartbeat in
  // place and /health stayed green until the 28h staleness threshold.
  try {
    const { recordHeartbeat } = await import("../lib/cron-heartbeat");
    recordHeartbeat(
      "alpha-calls-cron",
      "error",
      `run exited non-zero: ${(err as Error)?.message ?? String(err)}`.slice(0, 500)
    );
  } catch (heartbeatError) {
    console.error("Failed to record error heartbeat:", heartbeatError);
  }
  console.error(err);
  process.exit(1);
});
