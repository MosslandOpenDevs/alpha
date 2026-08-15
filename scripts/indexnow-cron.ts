/**
 * IndexNow auto-ping cron.
 *
 * 매주 1회 (또는 수동) 실행 → seo_pages에서 lastmod가 마지막 ping 후
 * 갱신된 페이지만 ping. 첫 실행은 모든 indexed page 발사.
 *
 * 사용법:
 *   pnpm tsx scripts/indexnow-cron.ts                   # 변경분만 ping
 *   pnpm tsx scripts/indexnow-cron.ts --all              # 전체 발사
 *   pnpm tsx scripts/indexnow-cron.ts --dry-run          # 발사 없이 출력만
 *
 * pm2 cron: 매주 월요일 04:00 KST.
 */

import fs from "node:fs";
import path from "node:path";

// .env.local 수동 로드 (Next.js 밖에서 실행되므로 자동 로드 안 됨)
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

// Keep state beside the persistent SQLite DB by default. A release-local
// `cwd/data` file disappears on every worktree deployment and causes the next
// run to submit the entire index again.
const STATE_FILE = process.env.INDEXNOW_STATE_FILE
  ? path.resolve(process.env.INDEXNOW_STATE_FILE)
  : path.join(
      process.env.DB_PATH
        ? path.dirname(path.resolve(process.env.DB_PATH))
        : path.join(process.cwd(), "data"),
      "indexnow-cron-state.json"
    );

type State = { lastPingedAt?: string };

function loadState(): State {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: State) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tempFile = `${STATE_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), { mode: 0o644 });
    fs.renameSync(tempFile, STATE_FILE);
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
}

async function main() {
  // Advance the watermark only to the instant before candidates are read.
  // Pages written while the HTTP request is in flight then remain eligible
  // for the next run instead of falling behind a later completion timestamp.
  const runStartedAt = new Date().toISOString();

  // env 로드 후 동적 import (DB_PATH 등을 read하는 모듈이 env를 본 뒤 로드되도록)
  const { listIndexedPages } = await import("../lib/db");
  const { submitUrls, INDEXNOW_ENABLED } = await import("../lib/indexnow");
  const { SITE } = await import("../lib/seo");

  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const dryRun = args.includes("--dry-run");

  if (!INDEXNOW_ENABLED && !dryRun) {
    console.error("INDEXNOW_KEY not set. Skipping ping. (use --dry-run to preview)");
    process.exit(0);
  }

  const state = loadState();
  // An unparseable watermark (hand-edited file) would make every comparison
  // below false and silently stop pinging forever — treat it as a first run.
  const parsedLastPing = state.lastPingedAt ? Date.parse(state.lastPingedAt) : 0;
  const lastPingTs = Number.isFinite(parsedLastPing) ? parsedLastPing : 0;

  const pages = listIndexedPages();
  const candidates = all
    ? pages
    : pages.filter((p) => Date.parse(p.lastmod) > lastPingTs);

  console.log(
    `Mode: ${all ? "all" : "delta"} · candidates: ${candidates.length} / ${pages.length}` +
      (lastPingTs ? ` · since ${state.lastPingedAt}` : " · first run")
  );

  if (candidates.length === 0) {
    console.log("No pages to ping.");
    return;
  }

  const urls = candidates.map((p: { path: string }) => `${SITE.baseUrl}${p.path}`);

  if (dryRun) {
    console.log(`Would ping ${urls.length} URLs:`);
    for (const u of urls.slice(0, 20)) console.log("  " + u);
    if (urls.length > 20) console.log(`  ... and ${urls.length - 20} more`);
    return;
  }

  let submitted = 0;
  const batchSize = 10_000;
  for (let offset = 0; offset < urls.length; offset += batchSize) {
    const batch = urls.slice(offset, offset + batchSize);
    const result = await submitUrls(batch);
    console.log(
      `Ping ${result.ok ? "OK" : "FAIL"} status=${result.status} count=${result.count}`
    );
    if (!result.ok) {
      throw new Error(
        `IndexNow submission failed after ${submitted}/${urls.length} URLs`
      );
    }
    submitted += result.count;
  }

  saveState({ lastPingedAt: runStartedAt });
  console.log(`State saved after ${submitted} URLs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
