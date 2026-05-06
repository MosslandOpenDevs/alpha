/**
 * AI synthesis 배치 생성기.
 *
 * 사용법:
 *   pnpm tsx scripts/generate-synthesis.ts entity bitcoin    # 단일
 *   pnpm tsx scripts/generate-synthesis.ts top --type=entity --limit=20  # top N
 *   pnpm tsx scripts/generate-synthesis.ts top --limit=10                # 모든 type top
 *
 * 비용: 평균 영상 10개 합성 1회 ~$0.001. 100개 ~$0.10.
 */

import fs from "node:fs";
import path from "node:path";

// .env.local 로드 + production DB 강제
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

async function runOne(refType: "entity" | "topic" | "event", refId: string) {
  const { generateSynthesis } = await import("../lib/synthesis");
  process.stdout.write(`  ${refType}:${refId} ... `);
  try {
    const result = await generateSynthesis(refType, refId);
    process.stdout.write(
      `OK ${result.cacheHit ? "[CACHE]" : `[${result.costUsd.toFixed(4)}$]`}\n`
    );
    return { ok: true, cost: result.costUsd, cached: result.cacheHit };
  } catch (err) {
    process.stdout.write(`FAIL: ${(err as Error).message}\n`);
    return { ok: false, cost: 0, cached: false };
  }
}

async function runTop(opts: { type?: string; limit: number }) {
  const { getAllEntities, getAllTopics, getAllEvents } = await import("../lib/mic");
  const targets: { type: "entity" | "topic" | "event"; id: string; videoCount: number }[] = [];
  if (!opts.type || opts.type === "entity") {
    for (const e of getAllEntities().sort((a, b) => b.videoCount - a.videoCount)) {
      if (e.videoCount < 3) continue;
      targets.push({ type: "entity", id: e.id, videoCount: e.videoCount });
    }
  }
  if (!opts.type || opts.type === "topic") {
    for (const t of getAllTopics().sort((a, b) => b.videoCount - a.videoCount)) {
      if (t.videoCount < 3) continue;
      targets.push({ type: "topic", id: t.id, videoCount: t.videoCount });
    }
  }
  if (!opts.type || opts.type === "event") {
    for (const ev of getAllEvents().sort((a, b) => b.videoCount - a.videoCount)) {
      if (ev.videoCount < 3) continue;
      targets.push({ type: "event", id: ev.id, videoCount: ev.videoCount });
    }
  }
  targets.sort((a, b) => b.videoCount - a.videoCount);
  const sel = targets.slice(0, opts.limit);

  console.log(`Targets: ${sel.length} (filtered to videoCount ≥ 3)`);
  let totalCost = 0;
  let cached = 0;
  let failed = 0;
  for (const t of sel) {
    const r = await runOne(t.type, t.id);
    totalCost += r.cost;
    if (r.cached) cached++;
    if (!r.ok) failed++;
  }
  console.log(
    `\nDone. Total cost: $${totalCost.toFixed(4)} · cache hits: ${cached}/${sel.length} · failures: ${failed}`
  );
}

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

  if (cmd === "top") {
    const limit = Number(parseFlag(args, "limit") ?? "20");
    const type = parseFlag(args, "type");
    await runTop({ type, limit });
  } else if (cmd === "entity" || cmd === "topic" || cmd === "event") {
    const id = args[0];
    if (!id) {
      console.error(`Usage: generate-synthesis ${cmd} <id>`);
      process.exit(1);
    }
    await runOne(cmd, id);
  } else {
    console.error(
      "Usage:\n" +
        "  generate-synthesis entity <id>           # 단일 합성\n" +
        "  generate-synthesis topic <id>\n" +
        "  generate-synthesis event <id>\n" +
        "  generate-synthesis top --type=entity --limit=20\n" +
        "  generate-synthesis top --limit=10        # all types\n"
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
