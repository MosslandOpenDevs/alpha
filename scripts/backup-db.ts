/**
 * 일일 DB 백업 — 스냅샷 → 무결성 검사 → (선택) 호스트 밖으로 복사.
 *
 * 왜 별도 cron 인가. 지금까지 DB 백업은 scripts/deploy.sh 의 swap 직전에만
 * 찍혔다. 그러면 두 가지가 따라온다:
 *
 *   - RPO 가 배포 주기다. 하루 배포가 없으면 하루치가, 일주일 없으면 일주일치가
 *     보호되지 않는다. 손실 가능한 데이터는 커뮤니티 글·call·audit 기록처럼
 *     재생성이 불가능한 것들이다.
 *   - 사본이 원본과 같은 디스크에 있다. `~/backups/alpha` 는 호스트가
 *     사라지면 원본과 함께 사라진다. 그건 백업이 아니라 실행 취소다.
 *
 * 그래서 이 스크립트는 매일 돌고, 사본을 *검사하고*, `BACKUP_REMOTE` 가
 * 설정돼 있으면 호스트 밖으로 민다. 검사가 중요한 이유: 복원할 수 없는 백업이
 * 있다는 사실은 복원할 때 알게 되며, 그때는 이미 늦다.
 *
 * 환경변수:
 *   BACKUP_DIR      스냅샷 위치 (기본 ~/backups/alpha — deploy.sh 와 같은 곳)
 *   BACKUP_KEEP     보관 개수 (기본 14)
 *   BACKUP_REMOTE   rsync 목적지. 예) user@host:/srv/alpha-backups/
 *                   비어 있으면 로컬 스냅샷만 — off-host 아님을 로그가 말한다.
 *   BACKUP_RSYNC_BIN rsync 실행 파일 (기본 rsync)
 *
 * 사용법:
 *   pnpm tsx scripts/backup-db.ts              # 지금 한 번
 *   pnpm tsx scripts/backup-db.ts --scheduled  # 03시 KST 에만 (pm2 cron)
 *
 * 복원:
 *   pm2 stop all
 *   rm -f "$DB_PATH-wal" "$DB_PATH-shm" && cp <snapshot> "$DB_PATH"
 *   pm2 start all
 *   스냅샷 한 파일에 그 시점의 내용이 전부 들어 있다. 원본의 낡은 -wal/-shm 이
 *   남아 있으면 복원한 파일 위에 그게 다시 적용되므로 먼저 지운다.
 *
 * pm2 cron: 매일 18:00 UTC = 03:00 KST.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadScriptEnv } from "../lib/script-env";
// Type-only: the value side stays behind the dynamic import below, which
// must not run before loadScriptEnv() has put DB_PATH in the environment.
import type { OffHostState } from "../lib/cron-heartbeat";

loadScriptEnv();

const execFileAsync = promisify(execFile);

/** Intended KST hour of the pm2 cron. */
const SCHEDULED_KST_HOUR = 3;

function backupDir(): string {
  return path.resolve(
    process.env.BACKUP_DIR || path.join(os.homedir(), "backups", "alpha")
  );
}

/** Snapshot the live DB through better-sqlite3's own backup API.
 *
 *  Not `cp`: the DB runs in WAL mode, so the .sqlite file on its own is a
 *  torn read — the recent writes live in -wal until a checkpoint. `.backup()`
 *  produces one finished, self-contained file. deploy.sh does the same thing
 *  inline; this is the same call with a verification step after it. */
async function snapshot(src: string, dest: string): Promise<void> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(src, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
}

/** Would this file actually restore? `PRAGMA integrity_check` walks the whole
 *  b-tree, and the row count is a second opinion that the pages it walked hold
 *  the data we meant to keep. */
async function verify(file: string): Promise<{ ok: boolean; note: string }> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(file, { readonly: true });
  try {
    const check = db.pragma("integrity_check", { simple: true });
    if (check !== "ok") return { ok: false, note: `integrity_check=${check}` };
    const posts = (
      db.prepare(`SELECT COUNT(*) AS n FROM alpha_posts`).get() as { n: number }
    ).n;
    return { ok: true, note: `integrity ok, posts=${posts}` };
  } catch (err) {
    return { ok: false, note: `열 수 없음: ${(err as Error).message}` };
  } finally {
    db.close();
  }
}

/** A snapshot is three files, not one: the copy inherits the source's WAL
 *  mode, so opening it to verify leaves a -wal and a -shm beside it. Remove
 *  the set, or a discarded snapshot leaves debris that looks like a snapshot. */
function removeSnapshot(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    fs.rmSync(f, { force: true });
  }
}

/** Keep the newest N snapshots. Every run adds a full copy of the DB. */
function prune(dir: string, keep: number): number {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("alpha-daily-") && f.endsWith(".sqlite"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  let removed = 0;
  for (const { f } of files.slice(keep)) {
    removeSnapshot(path.join(dir, f));
    removed++;
  }
  return removed;
}

async function main() {
  const args = process.argv.slice(2);
  const { scheduledSkipReason } = await import("../lib/kst");
  const skip = scheduledSkipReason(args, SCHEDULED_KST_HOUR);
  if (skip) {
    console.log(skip);
    return;
  }

  const { recordHeartbeat, offHostToken } = await import("../lib/cron-heartbeat");
  const src = process.env.DB_PATH;
  if (!src || !fs.existsSync(src)) {
    const note = `DB_PATH 없음 또는 파일 없음: ${src ?? "(unset)"}`;
    console.error(note);
    recordHeartbeat("alpha-backup-cron", "error", note);
    process.exitCode = 1;
    return;
  }

  const dir = backupDir();
  const keep = Number(process.env.BACKUP_KEEP || "14");
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error("BACKUP_KEEP must be a positive integer");
  }
  const remote = process.env.BACKUP_REMOTE || "";

  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const dest = path.join(dir, `alpha-daily-${stamp}.sqlite`);

  try {
    await snapshot(src, dest);
  } catch (err) {
    const note = `스냅샷 실패: ${(err as Error).message}`;
    console.error(note);
    removeSnapshot(dest);
    recordHeartbeat("alpha-backup-cron", "error", note);
    process.exitCode = 1;
    return;
  }

  const check = await verify(dest);
  if (!check.ok) {
    // A snapshot that does not verify is worse than none: it would be trusted.
    const note = `검증 실패 — ${check.note}`;
    console.error(note);
    removeSnapshot(dest);
    recordHeartbeat("alpha-backup-cron", "error", note);
    process.exitCode = 1;
    return;
  }

  // Drop the -wal/-shm that verifying just created, so what is retained (and
  // rsynced) is the single self-contained file the restore note describes.
  fs.rmSync(`${dest}-wal`, { force: true });
  fs.rmSync(`${dest}-shm`, { force: true });

  const sizeMb = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
  console.log(`snapshot ${path.basename(dest)} (${sizeMb}MB) — ${check.note}`);

  // The off-host leg. Without it everything above is one disk failure away
  // from nothing, so a configured remote that refuses is an error, not a
  // warning — the local copy still exists, but the box is a single point of
  // failure again and someone has to know.
  let offHost = "off-host 미설정 (BACKUP_REMOTE)";
  let offHostState: OffHostState = "none";
  let status: "ok" | "error" = "ok";
  if (remote) {
    const rsync = process.env.BACKUP_RSYNC_BIN || "rsync";
    try {
      await execFileAsync(rsync, ["-a", "--", dest, remote], {
        timeout: 15 * 60_000,
      });
      offHost = `off-host 복사 완료 → ${remote}`;
      offHostState = "ok";
      console.log(offHost);
    } catch (err) {
      offHost = `off-host 복사 실패 → ${remote}: ${(err as Error).message.slice(0, 200)}`;
      offHostState = "fail";
      console.error(offHost);
      status = "error";
    }
  } else {
    console.warn(
      `⚠ ${offHost} — 사본이 원본과 같은 호스트에 있습니다. 호스트 손실 시 둘 다 사라집니다.`
    );
  }

  const removed = prune(dir, keep);
  const note = `${offHostToken(offHostState)} · ${path.basename(dest)} ${sizeMb}MB · ${check.note} · ${offHost} · 정리 ${removed}건 (보관 ${keep})`;
  console.log(`Heartbeat: ${status} — ${note}`);
  recordHeartbeat("alpha-backup-cron", status, note);
  if (status === "error") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
