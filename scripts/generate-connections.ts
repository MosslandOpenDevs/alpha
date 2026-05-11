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

async function runTop(limit: number) {
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
  console.log(
    `\nDone. Cost: $${totalCost.toFixed(4)} · cache: ${cached} · failed: ${failed}`
  );
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

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);
  if (cmd === "top") {
    const limit = Number(parseFlag(args, "limit") ?? "50");
    await runTop(limit);
  } else if (cmd === "pair") {
    const [a, b] = args;
    if (!a || !b) {
      console.error("Usage: generate-connections pair <a> <b>");
      process.exit(1);
    }
    await runPair(a, b);
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
  .then(async () => {
    const { recordHeartbeat } = await import("../lib/cron-heartbeat");
    recordHeartbeat("alpha-connections-cron", "ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
