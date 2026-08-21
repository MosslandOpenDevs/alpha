/**
 * Trackable calls — eligibility, the write, and the one invariant the site's
 * track record rests on: a persona stance post on a priceable asset and its
 * call either both exist or neither does.
 *
 * That invariant used to be "write the post, then fetch a price, then insert
 * the call inside a `catch {}`". It held right up until CoinGecko answered
 * slowly, and /agents had nothing to show for months. It is cheap to assert
 * and expensive to rediscover, so it is asserted here.
 *
 * Runs against a throwaway SQLite file. No network: the price is passed in,
 * which is the whole point of insertCallForPost().
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

type Calls = typeof import("../lib/calls");
type Community = typeof import("../lib/community");
type Db = typeof import("../lib/db");

let calls: Calls;
let community: Community;
let db: Db;
let tmpDir: string;

/** A post as the writer hands it over, with only the fields a call reads. */
function post(over: Partial<Parameters<Calls["callDirectionFor"]>[0]> = {}) {
  return {
    id: `p-${Math.random().toString(16).slice(2, 10)}`,
    ref_type: "asset",
    ref_id: "bitcoin",
    parent_id: null,
    author_kind: "agent",
    author_handle: "@테스트",
    stance: "agree",
    created_at: "2026-08-21T00:00:00.000Z",
    ...over,
  };
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-calls-test-"));
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  // No canonical corpus in a test run; lib/mic.ts degrades to empty and the
  // call falls back to the raw asset id as its label.
  process.env.MIC_DATA_PATH = path.join(tmpDir, "mic-data");
  // Imported after the env is set — lib/db.ts reads DB_PATH at module load.
  calls = await import("../lib/calls");
  community = await import("../lib/community");
  db = await import("../lib/db");
  calls.ensureCallsTable();
  community.ensureCommunityTables();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("callDirectionFor", () => {
  it("maps a stance to a direction", () => {
    assert.equal(calls.callDirectionFor(post({ stance: "agree" })), "up");
    assert.equal(calls.callDirectionFor(post({ stance: "disagree" })), "down");
  });

  it("refuses a stance that is not a direction", () => {
    for (const stance of ["observe", "neutral", "", null, "AGREE", "up"]) {
      assert.equal(calls.callDirectionFor(post({ stance })), null, `stance=${stance}`);
    }
  });

  it("refuses anything that is not a top-level asset post", () => {
    assert.equal(calls.callDirectionFor(post({ ref_type: "entity" })), null);
    assert.equal(calls.callDirectionFor(post({ ref_id: null })), null);
    // Replies are not calls — the track record counts a first judgement on a
    // page, and three of the four calls ever published came from replies
    // before this was enforced.
    assert.equal(calls.callDirectionFor(post({ parent_id: "p-parent" })), null);
  });

  it("refuses an asset with no price source, and a pegged one", () => {
    assert.equal(calls.callDirectionFor(post({ ref_id: "gpu" })), null);
    // usdt is priceable but not callable: a 7-day direction on a dollar
    // stablecoin cannot be right or wrong.
    assert.equal(calls.callDirectionFor(post({ ref_id: "usdt" })), null);
  });
});

describe("insertCallForPost", () => {
  it("records the price, the horizon and the band in force", () => {
    const p = post({ ref_id: "bitcoin", stance: "disagree" });
    const call = calls.insertCallForPost(p, 61234.5);
    assert.ok(call);
    assert.equal(call.direction, "down");
    assert.equal(call.reference_price, 61234.5);
    assert.equal(call.horizon_days, 7);
    assert.equal(call.resolution_status, "pending");
    assert.equal(call.flat_pct, 1); // crypto band
    assert.equal(
      call.target_date,
      new Date("2026-08-28T00:00:00.000Z").toISOString()
    );
  });

  it("uses the asset class's own flat band, not one number for everything", () => {
    // An index moves less than a coin; grading both at ±1% would land four in
    // ten S&P calls unscoreable against one in eight for crypto.
    const call = calls.insertCallForPost(post({ ref_id: "sp500" }), 5000);
    assert.equal(call?.flat_pct, 0.5);
  });

  it("is idempotent per post", () => {
    const p = post();
    assert.ok(calls.insertCallForPost(p, 100));
    assert.equal(calls.insertCallForPost(p, 100), null);
  });

  it("throws rather than skip when the price is unusable", () => {
    // The caller has already claimed to hold a price. Dropping the call here
    // is exactly the silent failure this split exists to remove.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => calls.insertCallForPost(post(), bad),
        /unusable reference price/
      );
    }
  });
});

describe("createPostWithCall — a stance post and its call are one write", () => {
  // The real function lib/persona-post.ts calls, not a transaction rebuilt
  // here: a test that re-creates the pattern would pass even if the caller
  // stopped using it, which is exactly the regression being guarded.
  const write = (body: string, refId: string, price: number | null) =>
    calls.createPostWithCall(
      {
        refType: "asset",
        refId,
        body,
        stance: "agree",
        authorKind: "agent",
        authorToken: "agent:테스트",
        authorHandle: "@테스트",
      },
      price
    );

  const countPosts = (body: string) =>
    (
      db
        .getDb()
        .prepare(`SELECT COUNT(*) AS n FROM alpha_posts WHERE body = ?`)
        .get(body) as { n: number }
    ).n;

  const callFor = (postId: string) =>
    db
      .getDb()
      .prepare(`SELECT id FROM alpha_trackable_calls WHERE post_id = ?`)
      .get(postId) as { id: string } | undefined;

  it("publishes both when the price is good", () => {
    const p = write("좋은 가격", "ethereum", 3000);
    assert.equal(countPosts("좋은 가격"), 1);
    assert.ok(callFor(p.id));
  });

  it("publishes neither when the call cannot be written", () => {
    assert.throws(() => write("나쁜 가격", "ethereum", 0));
    // The regression: the post used to survive on its own, and /agents could
    // never show the call it implied.
    assert.equal(countPosts("나쁜 가격"), 0);
  });

  it("still publishes a post that was never going to carry a call", () => {
    // Not every persona post is a call. An unpriceable page has no reference
    // price to pass, and the post stands on its own — with no call row.
    const p = write("가격 없는 페이지", "gpu", null);
    assert.equal(countPosts("가격 없는 페이지"), 1);
    assert.equal(callFor(p.id), undefined);
  });

  it("writes no call for a stance that is not a direction", () => {
    // observe is a real persona stance and a normal post; it is not a call.
    const p = calls.createPostWithCall(
      {
        refType: "asset",
        refId: "bitcoin",
        body: "관망",
        stance: "observe",
        authorKind: "agent",
        authorToken: "agent:테스트",
        authorHandle: "@테스트",
      },
      70000
    );
    assert.equal(countPosts("관망"), 1);
    assert.equal(callFor(p.id), undefined);
  });
});
