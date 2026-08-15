/**
 * AI 페르소나 일일 tick — 매일 N 페이지에 페르소나 발화 추가.
 *
 * 사용법:
 *   pnpm tsx scripts/persona-tick.ts                  # default: 10 페이지
 *   pnpm tsx scripts/persona-tick.ts --pages=5
 *   pnpm tsx scripts/persona-tick.ts --types=entity,asset
 *   pnpm tsx scripts/persona-tick.ts --scheduled          # 09시 KST 에만 실행
 *
 * pm2 cron: 매일 23:00 UTC = 다음날 08:00 KST.
 *
 * 알고리즘:
 *   - 활성 entity/topic/event 후보군 (videoCount ≥ 3)
 *   - 페르소나가 아직 발화 안 한 페이지 우선
 *   - 일일 cap 안 찬 페르소나 중 랜덤
 *   - 사람 댓글 5+ 페이지는 skip (HN decay)
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

/** Intended KST hour of the pm2 cron (09:00 KST = 00:00 UTC). */
const SCHEDULED_KST_HOUR = 9;

async function main() {
  const args = process.argv.slice(2);

  // PM2 starts every app once the moment it is registered, so a redeploy
  // would publish a full tick of persona posts off-schedule. --scheduled
  // makes that registration run a no-op outside the intended hour.
  if (args.includes("--scheduled")) {
    const { isScheduledNow } = await import("../lib/kst");
    const { ok, clock } = isScheduledNow(SCHEDULED_KST_HOUR);
    if (!ok) {
      console.log(
        `Scheduled tick skipped: ${clock.date} ${String(clock.hour).padStart(2, "0")}:xx KST is not ${String(SCHEDULED_KST_HOUR).padStart(2, "0")}:00-${String(SCHEDULED_KST_HOUR).padStart(2, "0")}:59 KST.`
      );
      return;
    }
  }

  const pages = Number(parseFlag(args, "pages") ?? "10");
  if (!Number.isInteger(pages) || pages < 1 || pages > 100) {
    throw new Error("--pages must be an integer between 1 and 100");
  }

  const validTypes = new Set(["entity", "asset", "topic", "event"] as const);
  const requestedTypes = (parseFlag(args, "types") ?? "entity,asset,topic,event")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const invalidTypes = requestedTypes.filter(
    (value) => !validTypes.has(value as "entity" | "asset" | "topic" | "event")
  );
  if (requestedTypes.length === 0 || invalidTypes.length > 0) {
    throw new Error(`--types contains invalid values: ${invalidTypes.join(", ")}`);
  }
  const selectedTypes = new Set(requestedTypes);

  const { getActiveAgents } = await import("../lib/agents");
  const { generatePersonaPost } = await import("../lib/persona-post");
  const { getAllEntities, getAllTopics, getAllEvents } = await import("../lib/mic");

  const agents = getActiveAgents();
  const today = new Date().toISOString().slice(0, 10);

  // Build candidate pool — entity/topic/event with videoCount ≥ 3
  type Candidate = { refType: "entity" | "topic" | "event" | "asset"; refId: string };
  const pool: Candidate[] = [];
  for (const e of getAllEntities()) {
    if (e.videoCount < 3) continue;
    const refType = e.type === "asset" ? "asset" : "entity";
    if (!selectedTypes.has(refType)) continue;
    pool.push({
      refType,
      refId: e.id,
    });
  }
  if (selectedTypes.has("topic")) {
    for (const t of getAllTopics()) {
      if (t.videoCount < 3) continue;
      pool.push({ refType: "topic", refId: t.id });
    }
  }
  if (selectedTypes.has("event")) {
    for (const ev of getAllEvents()) {
      if (ev.videoCount < 3) continue;
      pool.push({ refType: "event", refId: ev.id });
    }
  }

  // Shuffle
  pool.sort(() => Math.random() - 0.5);

  console.log(
    `Tick ${today}: pool=${pool.length}, types=${[...selectedTypes].join(",")}, agents=${agents.length}, target=${pages} posts`
  );

  let posted = 0;
  let totalCost = 0;
  let attempts = 0;
  const maxAttempts = pages * 5; // safety bound

  for (const c of pool) {
    if (posted >= pages || attempts >= maxAttempts) break;
    attempts++;

    // Pick an agent, prefer those that haven't posted recently
    const agent = agents[Math.floor(Math.random() * agents.length)];

    process.stdout.write(`  ${c.refType}:${c.refId} × @${agent.handle} ... `);
    try {
      const r = await generatePersonaPost({
        handle: agent.handle,
        refType: c.refType,
        refId: c.refId,
      });
      if (r.ok && r.post) {
        posted++;
        totalCost += r.costUsd ?? 0;
        process.stdout.write(`OK [$${(r.costUsd ?? 0).toFixed(4)}]\n`);
      } else {
        process.stdout.write(`SKIP: ${r.reason}\n`);
      }
    } catch (err) {
      process.stdout.write(`FAIL: ${(err as Error).message}\n`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(
    `\nTick done. Posted: ${posted}/${pages} · cost: $${totalCost.toFixed(4)} · attempts: ${attempts}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
