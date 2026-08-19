/**
 * 기존 audit JSON 결과를 alpha_audit_runs 로 백필 — 1회성.
 *
 * The weekly audit has been writing JSON since 2026-05-06 and nothing read it.
 * lib/audit-log.ts now records a summary row per run so /health can show the
 * trend, but that only starts from the next Monday. Without this the page opens
 * on an empty table while three months of measurements sit on disk, and the
 * first data point would look like a beginning rather than the continuation it
 * is — the 0% is the whole finding.
 *
 * Idempotent: INSERT OR REPLACE keyed by date, so re-running is harmless.
 *
 * 사용법:
 *   pnpm tsx scripts/backfill-audit-runs.ts [--dir <경로>] [--dry-run]
 *   기본 경로: AUDIT_RESULTS_DIR, 없으면 docs/audit-results (구 위치)
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));
process.env.NODE_ENV = process.env.NODE_ENV || "production";

type Row = {
  query_id: string;
  category: string;
  llm: string;
  alpha_cited: boolean;
  error?: string;
};

/** scripts/audit-auto.ts only ever writes llm:"openai". A same-dated file can
 *  hold a one-off multi-vendor baseline (2026-05-06.json: chatgpt/claude/
 *  gemini/perplexity), which is a different measurement — merging it tripled
 *  that day's denominator and put four vendors in a gpt-4o-labelled table. */
const AUDIT_LLM = "openai";

function parseFlag(args: string[], name: string): string | undefined {
  const f = `--${name}=`;
  for (const a of args) if (a.startsWith(f)) return a.slice(f.length);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  // Default is the repo's historical location on purpose: this script exists to
  // import the runs written before AUDIT_RESULTS_DIR moved output next to the
  // DB. Pass --dir to read the new location.
  const dir = parseFlag(args, "dir") || path.join(process.cwd(), "docs", "audit-results");

  if (!fs.existsSync(dir)) {
    console.error(`결과 디렉터리 없음: ${dir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}.*\.json$/.test(f))
    .sort();
  if (files.length === 0) {
    console.error(`${dir} 에 결과 파일이 없습니다.`);
    process.exit(1);
  }

  const { recordAuditRun } = await import("../lib/audit-log");
  let written = 0;

  // Several files can share a date (2026-05-06.json and 2026-05-06-auto.json
  // are separate runs of the same day). The table is keyed by date, so merge
  // them instead of letting the last file silently overwrite the others.
  const byDate = new Map<string, Row[]>();

  for (const f of files) {
    const date = f.slice(0, 10);
    let rows: Row[];
    try {
      rows = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (err) {
      console.warn(`  ${f}: 파싱 실패 — 건너뜀 (${(err as Error).message})`);
      continue;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn(`  ${f}: 비어 있음 — 건너뜀`);
      continue;
    }

    const own = rows.filter((r) => r.llm === AUDIT_LLM);
    if (own.length !== rows.length) {
      console.log(
        `  ${f}: ${rows.length - own.length}행이 다른 vendor — 제외 (audit-auto 산출물 아님)`
      );
    }
    if (own.length) byDate.set(date, (byDate.get(date) ?? []).concat(own));
  }

  for (const [date, rows] of [...byDate.entries()].sort()) {
    const answers = rows.length;
    const queries = new Set(rows.map((r) => r.query_id)).size;
    const cited = rows.filter((r) => r.alpha_cited).length;
    const distinct = new Set(rows.filter((r) => r.alpha_cited).map((r) => r.query_id)).size;
    const mossland = rows.filter((r) => r.alpha_cited && r.category === "mossland").length;
    const errors = rows.filter((r) => r.error).length;

    console.log(
      `  ${date}: 답변 ${answers} (질의 ${queries}) · 인용 ${cited} ` +
        `(고유 ${distinct}, mossland ${mossland}) · 실패 ${errors}`
    );
    if (!dry) {
      recordAuditRun({
        date,
        answers,
        queries,
        cited,
        distinctCited: distinct,
        mosslandCited: mossland,
        errors,
      });
      written++;
    }
  }

  console.log(
    dry
      ? `\n(dry-run) 파일 ${files.length}개 → 날짜 ${byDate.size}개`
      : `\n${written}개 기록`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
