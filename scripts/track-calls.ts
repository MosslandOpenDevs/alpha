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

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));
process.env.NODE_ENV = process.env.NODE_ENV || "production";

// Reference prices are spot prices fetched when this script runs, so a post
// can only be recovered here while it is minutes old; otherwise it would be
// scored against a price that never existed at publication time.
//
// Only lib/persona-post.ts creates a call at write time. Anonymous community
// posts and persona replies never produce calls — that is intentional, not a
// gap this window is meant to cover. Historical calls need an explicit
// time-series backfill, not this spot-price path.
const MAX_BACKFILL_AGE_MINUTES = 15;

async function main() {
  const args = process.argv.slice(2);
  const skipBackfill = args.includes("--skip-backfill");
  const skipResolve = args.includes("--skip-resolve");

  const { createCallFromPost, resolveCall, getPendingCallsDue } = await import(
    "../lib/calls"
  );
  const { coingeckoIdFor } = await import("../lib/coingecko");
  const { getDb } = await import("../lib/db");

  // Trigger table creation by calling getHandleStats once
  const { getHandleStats } = await import("../lib/calls");
  getHandleStats("__init__");
  // Also ensure community tables (for posts join)
  const { ensureCommunityTables } = await import("../lib/community");
  ensureCommunityTables();

  void getDb;
  const Database = (await import("better-sqlite3")).default;
  const dbReadonly = new Database(process.env.DB_PATH!, { readonly: true });

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
    let created = 0;
    let skipped = 0;
    let unmapped = 0;
    for (const post of candidates) {
      if (!post.ref_id || !coingeckoIdFor(post.ref_id)) {
        skipped++;
        unmapped++;
        continue;
      }
      try {
        const call = await createCallFromPost(post);
        if (call) {
          created++;
          process.stdout.write(
            `  ✓ ${call.asset_id} ${call.direction} @${post.author_handle} → ref $${call.reference_price.toFixed(4)}\n`
          );
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`  ✗ ${post.id}: ${(err as Error).message}`);
      }
      // Rate-limit safety (CoinGecko free tier = 30 req/min)
      await new Promise((r) => setTimeout(r, 2200));
    }
    console.log(
      `Backfill done. Created ${created}, skipped ${skipped} (${unmapped} unmapped).\n`
    );
  }

  // === Phase 2: resolve ===
  if (!skipResolve) {
    const due = getPendingCallsDue();
    console.log(`Resolve: ${due.length} pending calls past target_date`);
    let resolved = 0;
    for (const call of due) {
      if (!coingeckoIdFor(call.asset_id)) {
        console.warn(`  - ${call.id}: no CoinGecko mapping for ${call.asset_id}`);
        continue;
      }
      try {
        const r = await resolveCall(call.id);
        if (r && r.resolution_status !== "pending") {
          resolved++;
          const sign = r.actual_change_pct! > 0 ? "+" : "";
          process.stdout.write(
            `  ✓ ${call.author_handle} ${call.asset_id} ${call.direction}: ${r.resolution_status} (${sign}${r.actual_change_pct!.toFixed(2)}%)\n`
          );
        }
      } catch (err) {
        console.error(`  ✗ ${call.id}: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 2200));
    }
    console.log(`Resolve done. ${resolved}/${due.length} resolved.\n`);
  }

  dbReadonly.close();

  const { recordHeartbeat } = await import("../lib/cron-heartbeat");
  recordHeartbeat(
    "alpha-calls-cron",
    "ok",
    `skipBackfill=${skipBackfill} skipResolve=${skipResolve}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
