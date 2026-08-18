/**
 * Connection 배치 생성기.
 *
 * 사용법:
 *   pnpm tsx scripts/generate-connections.ts top --limit=80   # 최다 co-mention pair top N
 *   pnpm tsx scripts/generate-connections.ts pair <a> <b>     # 특정 pair
 *
 * 비용: 페어당 ~$0.0001-0.0003. top 80 = ~$0.02.
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

function parseFlag(args: string[], name: string): string | undefined {
  const flag = `--${name}=`;
  for (const a of args) if (a.startsWith(flag)) return a.slice(flag.length);
  return undefined;
}

/** What a top-N run accomplished — the heartbeat is derived from this. */
export type ConnectionsTally = { attempted: number; generated: number; cached: number; failed: number };

/** Intended KST hour of the pm2 cron (07:30 KST = 22:30 UTC). */
const SCHEDULED_KST_HOUR = 7;

async function runTop(limit: number): Promise<ConnectionsTally> {
  const { getAllEntities } = await import("../lib/mic");
  const { generateConnection } = await import("../lib/connections");

  const entities = getAllEntities().filter((e) => e.videoCount >= 3);
  console.log(`Eligible entities: ${entities.length}`);

  // Compute co-mention counts via shared videoIds
  type Pair = { a: string; b: string; count: number };
  const pairs: Pair[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const A = entities[i];
      const B = entities[j];
      const shared = A.videoIds.filter((id) => B.videoIds.includes(id));
      if (shared.length >= 2) {
        pairs.push({ a: A.id, b: B.id, count: shared.length });
      }
    }
  }
  pairs.sort((p1, p2) => p2.count - p1.count);
  console.log(`Pairs with ≥2 co-mention: ${pairs.length}, top ${limit} 처리`);

  let totalCost = 0;
  let cached = 0;
  let failed = 0;
  for (const p of pairs.slice(0, limit)) {
    process.stdout.write(`  ${p.a} ↔ ${p.b} (n=${p.count}) ... `);
    try {
      const r = await generateConnection(p.a, p.b);
      totalCost += r.costUsd;
      if (r.cacheHit) cached++;
      const hypothesis = r.connection.hypothesis.slice(0, 60);
      process.stdout.write(
        `OK ${r.cacheHit ? "[CACHE]" : `[${r.costUsd.toFixed(4)}$]`} — ${hypothesis}\n`
      );
    } catch (err) {
      process.stdout.write(`FAIL: ${(err as Error).message}\n`);
      failed++;
    }
  }
  const attempted = pairs.slice(0, limit).length;
  console.log(
    `\nDone. Cost: $${totalCost.toFixed(4)} · cache: ${cached} · failed: ${failed}`
  );
  return { attempted, generated: attempted - cached - failed, cached, failed };
}

async function runPair(a: string, b: string) {
  const { generateConnection } = await import("../lib/connections");
  process.stdout.write(`${a} ↔ ${b} ... `);
  try {
    const r = await generateConnection(a, b);
    process.stdout.write(
      `OK ${r.cacheHit ? "[CACHE]" : `[${r.costUsd.toFixed(4)}$]`}\n`
    );
    console.log("Hypothesis:", r.connection.hypothesis);
    console.log("Relation:", r.connection.relationType);
    console.log("Confidence:", r.connection.confidence);
  } catch (err) {
    console.error("FAIL:", (err as Error).message);
    process.exit(1);
  }
}

async function main(): Promise<ConnectionsTally | null> {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);
  if (cmd === "top") {
    // Cron path only. Without this a release fires 80 Grok pair calls at
    // whatever hour the deploy happens and stamps the heartbeat with it.
    const { scheduledSkipReason } = await import("../lib/kst");
    const skip = scheduledSkipReason(args, SCHEDULED_KST_HOUR);
    if (skip) {
      console.log(skip);
      return null;
    }
    const limit = Number(parseFlag(args, "limit") ?? "50");
    return await runTop(limit);
  } else if (cmd === "pair") {
    const [a, b] = args;
    if (!a || !b) {
      console.error("Usage: generate-connections pair <a> <b>");
      process.exit(1);
    }
    await runPair(a, b);
    return null;
  } else {
    console.error(
      "Usage:\n" +
        "  generate-connections top --limit=50    # 최다 co-mention pair\n" +
        "  generate-connections pair <a> <b>      # 특정 pair\n"
    );
    process.exit(1);
  }
}

main()
  .then(async (tally) => {
    // Only the cron path (`top`) owns the heartbeat; an operator running a
    // single pair by hand must not overwrite the scheduled run's status.
    if (!tally) return;
    const { recordHeartbeat } = await import("../lib/cron-heartbeat");
    const summary =
      `attempted=${tally.attempted} generated=${tally.generated} ` +
      `cached=${tally.cached} failed=${tally.failed}`;
    // A flat "ok" here used to mean "the process exited zero" — it stayed
    // green even if every pair failed. Grade by what the run produced, but
    // reserve `error` for "nothing got through": lib/health.ts turns it into a
    // red subsystem and /api/health?strict=1 answers 503, so one flaky pair
    // out of eighty must not take the site's health signal down with it.
    const produced = tally.generated + tally.cached;
    const status =
      tally.attempted === 0
        ? "noop"
        : produced === 0
          ? "error"
          : "ok";
    console.log(`Heartbeat: ${status} — ${summary}`);
    recordHeartbeat("alpha-connections-cron", status, summary);
  })
  .catch(async (err) => {
    try {
      const { recordHeartbeat } = await import("../lib/cron-heartbeat");
      recordHeartbeat(
        "alpha-connections-cron",
        "error",
        `run exited non-zero: ${(err as Error)?.message ?? String(err)}`.slice(0, 500)
      );
    } catch (heartbeatError) {
      console.error("Failed to record error heartbeat:", heartbeatError);
    }
    console.error(err);
    process.exit(1);
  });
