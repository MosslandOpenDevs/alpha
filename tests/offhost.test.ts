/**
 * The off-host marker in the backup heartbeat note.
 *
 * scripts/backup-db.ts writes this token and lib/health.ts reads it, and the
 * whole point of the row is to be true before someone needs it. A silent
 * drift between writer and reader would put the row back where it was —
 * reporting `ok` for a copy sitting on the same disk as the original.
 *
 * Pure string work. The DB_PATH dance below exists only because
 * lib/cron-heartbeat.ts imports lib/db, which mkdirs its data directory at
 * module load; the temp path keeps that out of the checkout.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

type Heartbeat = typeof import("../lib/cron-heartbeat");

let hb: Heartbeat;
let tmpDir: string;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-offhost-test-"));
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  hb = await import("../lib/cron-heartbeat");
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("off-host marker", () => {
  it("round-trips every state", () => {
    for (const state of ["none", "ok", "fail"] as const) {
      assert.equal(hb.readOffHost(hb.offHostToken(state)), state);
    }
  });

  it("reads the note backup-db.ts actually writes", () => {
    // Verbatim shape from scripts/backup-db.ts: token first, then prose.
    const note =
      "offhost=none · alpha-daily-20260825T180000Z.sqlite 17.6MB · " +
      "integrity ok, posts=978 · off-host 미설정 (BACKUP_REMOTE) · 정리 0건 (보관 14)";
    assert.equal(hb.readOffHost(note), "none");
  });

  it("follows the token, not the prose", () => {
    // The prose says 미설정 and the token says otherwise. The token wins,
    // because prose is for people and gets rewritten; this is the contract.
    const note = "offhost=ok · off-host 미설정 이라는 옛 문구가 남아 있어도";
    assert.equal(hb.readOffHost(note), "ok");
  });

  it("returns null when there is no token", () => {
    // Heartbeats written before the token existed carry no verdict, and an
    // absent token is not evidence of an absent copy. health.ts leaves the
    // row alone rather than guessing; the next 03:00 run supplies the truth.
    assert.equal(hb.readOffHost("integrity ok, posts=978"), null);
    assert.equal(hb.readOffHost(null), null);
    assert.equal(hb.readOffHost(undefined), null);
  });
});
