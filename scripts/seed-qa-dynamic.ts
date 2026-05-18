/**
 * Dynamic Q&A seeding — reads top topics / events / entities from the
 * canonical store and generates natural questions for each, calling
 * askAlpha to produce permanent /ask/q/[hash] pages.
 *
 * Runs daily; idempotent (skips cached). Caps generation at 20 new Q&A
 * per run so cost stays bounded.
 *
 * Usage:
 *   pnpm tsx scripts/seed-qa-dynamic.ts                  # default 20/run
 *   pnpm tsx scripts/seed-qa-dynamic.ts --limit=40       # higher cap
 *   pnpm tsx scripts/seed-qa-dynamic.ts --dry-run        # preview only
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

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const LIMIT = (() => {
  const flag = ARGS.find((a) => a.startsWith("--limit="));
  return flag ? Number(flag.slice(8)) : 20;
})();

// Question templates — only safe, generally-applicable patterns.
const TOPIC_QS = [
  (label: string) => `${label}에 대한 한국 채널들의 입장은?`,
  (label: string) => `${label}의 핵심 쟁점은 무엇인가?`,
];
const ENTITY_QS = [
  (label: string) => `${label} 최근 한국 시장 분석은?`,
  (label: string) => `${label}에 대한 매크로 시각은?`,
];
const EVENT_QS = [
  (label: string) => `${label} 이후 시장 반응은?`,
  (label: string) => `${label}이 미친 영향은?`,
];

interface Candidate {
  q: string;
  source: { type: "topic" | "entity" | "event"; id: string; label: string };
}

async function main() {
  const { askAlpha, getCachedAnswer } = await import("../lib/ask");
  const { getAllTopics, getAllEntities, getAllEvents } = await import("../lib/mic");

  const topics = getAllTopics()
    .filter((t) => t.videoCount >= 3 && /^[a-z]/.test(t.id))
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 15);
  const entities = getAllEntities()
    .filter((e) => e.videoCount >= 5 && /^[a-z]/.test(e.id))
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 20);
  const events = getAllEvents()
    .filter((e) => e.videoCount >= 5 && /^[a-z]/.test(e.id))
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 15);

  const candidates: Candidate[] = [];
  for (const t of topics) {
    for (const tmpl of TOPIC_QS) {
      candidates.push({ q: tmpl(t.label), source: { type: "topic", id: t.id, label: t.label } });
    }
  }
  for (const e of entities) {
    for (const tmpl of ENTITY_QS) {
      candidates.push({ q: tmpl(e.label), source: { type: "entity", id: e.id, label: e.label } });
    }
  }
  for (const ev of events) {
    for (const tmpl of EVENT_QS) {
      candidates.push({ q: tmpl(ev.label), source: { type: "event", id: ev.id, label: ev.label } });
    }
  }

  console.log(`Candidates generated: ${candidates.length}`);
  const fresh = candidates.filter((c) => !getCachedAnswer(c.q));
  console.log(`After cache filter: ${fresh.length} fresh`);
  console.log(`Run cap: ${LIMIT}`);

  const todo = fresh.slice(0, LIMIT);
  if (DRY) {
    console.log("\nWould generate:");
    for (const c of todo) {
      console.log(`  [${c.source.type}/${c.source.id}] ${c.q}`);
    }
    return;
  }

  let success = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${c.q.slice(0, 55)} ... `);
    try {
      const r = await askAlpha(c.q);
      success++;
      process.stdout.write(`OK [${r.answer.length}자, ${r.citations.length} citations]\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`FAIL: ${(err as Error).message}\n`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nDone. Created ${success}, failed ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
