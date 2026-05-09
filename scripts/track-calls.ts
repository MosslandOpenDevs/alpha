/**
 * Trackable calls 일일 cron — 두 단계:
 *
 * Phase 1: backfill — 아직 call 레코드 없는 모든 post에 대해 시도
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

async function main() {
  const args = process.argv.slice(2);
  const skipBackfill = args.includes("--skip-backfill");
  const skipResolve = args.includes("--skip-resolve");

  const { createCallFromPost, resolveCall, getPendingCallsDue } = await import(
    "../lib/calls"
  );
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
    for (const post of candidates) {
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
    console.log(`Backfill done. Created ${created}, skipped ${skipped}.\n`);
  }

  // === Phase 2: resolve ===
  if (!skipResolve) {
    const due = getPendingCallsDue();
    console.log(`Resolve: ${due.length} pending calls past target_date`);
    let resolved = 0;
    for (const call of due) {
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
