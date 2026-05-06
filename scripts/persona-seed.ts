/**
 * AI 페르소나 초기 시드 발행기.
 *
 * 사용법:
 *   pnpm tsx scripts/persona-seed.ts                    # default: top 20 entity × 2 페르소나
 *   pnpm tsx scripts/persona-seed.ts --limit=10 --personas=2
 *   pnpm tsx scripts/persona-seed.ts --dry-run
 *   pnpm tsx scripts/persona-seed.ts --type=topic --limit=10
 *
 * 비용: 페이지당 페르소나 수 × $0.0003.
 *   top 20 entity × 2 페르소나 = 40 posts × $0.0003 = ~$0.012
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

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(parseFlag(args, "limit") ?? "20");
  const personasPerPage = Number(parseFlag(args, "personas") ?? "2");
  const refType = (parseFlag(args, "type") || "entity") as
    | "entity"
    | "topic"
    | "event"
    | "asset";
  const dryRun = args.includes("--dry-run");

  const { getActiveAgents } = await import("../lib/agents");
  const { generatePersonaPost } = await import("../lib/persona-post");
  const {
    getAllEntities,
    getAllTopics,
    getAllEvents,
  } = await import("../lib/mic");

  const agents = getActiveAgents();
  console.log(`Active agents: ${agents.length}`);

  // pick targets
  let targets: { id: string; label: string; effectiveRefType: typeof refType }[] = [];
  if (refType === "entity" || refType === "asset") {
    const entities = getAllEntities()
      .filter((e) => e.videoCount >= 3)
      .sort((a, b) => b.videoCount - a.videoCount);
    targets = entities.slice(0, limit).map((e) => ({
      id: e.id,
      label: e.label,
      // asset 타입 entity는 'asset' ref_type 사용 (UI matching)
      effectiveRefType: e.type === "asset" ? "asset" : "entity",
    }));
  } else if (refType === "topic") {
    const topics = getAllTopics()
      .filter((t) => t.videoCount >= 3)
      .sort((a, b) => b.videoCount - a.videoCount);
    targets = topics.slice(0, limit).map((t) => ({
      id: t.id,
      label: t.label,
      effectiveRefType: "topic" as const,
    }));
  } else if (refType === "event") {
    const events = getAllEvents()
      .filter((e) => e.videoCount >= 3)
      .sort((a, b) => b.videoCount - a.videoCount);
    targets = events.slice(0, limit).map((e) => ({
      id: e.id,
      label: e.label,
      effectiveRefType: "event" as const,
    }));
  }

  console.log(`Targets: ${targets.length} ${refType}, ${personasPerPage} personas each\n`);

  let totalCost = 0;
  let success = 0;
  let skipped = 0;
  let failed = 0;

  // 페르소나를 round-robin으로 분배 (각 페이지에 다른 페르소나)
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    // 매 페이지마다 다른 시작점
    const startIdx = i % agents.length;
    for (let j = 0; j < personasPerPage; j++) {
      const agent = agents[(startIdx + j) % agents.length];
      process.stdout.write(`  ${t.effectiveRefType}:${t.id} × @${agent.handle} ... `);
      try {
        const r = await generatePersonaPost({
          handle: agent.handle,
          refType: t.effectiveRefType,
          refId: t.id,
          dryRun,
        });
        if (r.ok && r.post) {
          totalCost += r.costUsd ?? 0;
          success++;
          process.stdout.write(
            `OK [$${(r.costUsd ?? 0).toFixed(4)}] — ${r.post.body.slice(0, 60)}\n`
          );
        } else {
          skipped++;
          process.stdout.write(`SKIP: ${r.reason}\n`);
        }
      } catch (err) {
        failed++;
        process.stdout.write(`FAIL: ${(err as Error).message}\n`);
      }
      // rate-limit safety
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(
    `\nDone. Cost: $${totalCost.toFixed(4)} · success: ${success} · skipped: ${skipped} · failed: ${failed}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
