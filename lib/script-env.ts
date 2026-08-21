/**
 * What a cron script does before it touches anything else.
 *
 * Twenty scripts under scripts/ carried their own byte-identical copy of this
 * (two of them subtly different, which is how copies go). One copy means one
 * place to fix when the rule changes — and, less obviously, it is what let
 * `tsc --noEmit` start covering scripts/ at all: every copy assigned to
 * `process.env.NODE_ENV`, which Next declares readonly, so the whole
 * directory had to stay out of the typecheck. Twenty-four cron scripts —
 * where every production incident in this repo has originated — were
 * therefore never typechecked by CI.
 *
 * Call it at module top level, before the dynamic `await import("../lib/…")`
 * that every script uses. Static imports are hoisted, so a static import of
 * this module still runs before those.
 */

import fs from "node:fs";
import path from "node:path";

/** Read `KEY=value` lines into process.env. Existing values win, so a real
 *  environment variable always beats the file. */
function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

/**
 * Default NODE_ENV, for a script that manages its own environment otherwise
 * (scripts/check-health.ts builds a throwaway DB and must not read .env).
 *
 * The cast is not a shortcut — `next/types/global.d.ts` declares
 * ProcessEnv.NODE_ENV readonly for application code, which this is not. It
 * lives here so there is exactly one of it to find.
 */
export function defaultNodeEnv(value = "production"): void {
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = env.NODE_ENV || value;
}

/**
 * `.env.local`, then `.env`, then default NODE_ENV to production.
 *
 * The NODE_ENV default is for hand-run invocations (`pnpm tsx scripts/…`);
 * the pm2 apps already set it (ecosystem.config.cjs).
 */
export function loadScriptEnv(): void {
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".env"));
  defaultNodeEnv();
}
