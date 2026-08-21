/**
 * KST wall-clock helpers — the arithmetic every cron guard depends on.
 *
 * These are worth a test precisely because they are boring: a nine-hour
 * offset applied in the wrong direction is invisible in review and moved
 * every scheduled job by nine hours once already (see the history note in
 * ecosystem.config.cjs). Nothing here touches the DB or the network.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kstClock, kstDayBounds, isScheduledNow, scheduledSkipReason } from "../lib/kst";

describe("kstClock", () => {
  it("reads an instant as Korean wall-clock time", () => {
    // 2026-08-20T15:00:00Z is exactly 2026-08-21 00:00 KST — the first
    // instant of the Korean day, and the boundary every daily cap turns on.
    const c = kstClock(new Date("2026-08-20T15:00:00Z"));
    assert.equal(c.date, "2026-08-21");
    assert.equal(c.hour, 0);
    assert.equal(c.weekday, 5); // Friday
  });

  it("is one minute earlier still the previous Korean day", () => {
    const c = kstClock(new Date("2026-08-20T14:59:00Z"));
    assert.equal(c.date, "2026-08-20");
    assert.equal(c.hour, 23);
  });
});

describe("kstDayBounds", () => {
  it("spans 15:00Z the day before to 15:00Z the day of", () => {
    const { start, end } = kstDayBounds("2026-08-21");
    assert.equal(new Date(start).toISOString(), "2026-08-20T15:00:00.000Z");
    assert.equal(new Date(end).toISOString(), "2026-08-21T15:00:00.000Z");
    assert.equal(end - start, 24 * 3600_000);
  });

  it("rejects a malformed date rather than returning a shifted window", () => {
    assert.throws(() => kstDayBounds("2026-8-21"), /Invalid calendar date/);
    assert.throws(() => kstDayBounds("not-a-date"), /Invalid calendar date/);
  });

  it("rejects a date that does not exist", () => {
    // Date.parse would roll 02-30 forward to 03-02 and silently bound the
    // wrong day.
    assert.throws(() => kstDayBounds("2026-02-30"), /Invalid calendar date/);
  });
});

describe("isScheduledNow", () => {
  // 2026-08-17T02:00:00Z = Monday 11:00 KST — the citation audit's slot.
  const mondayEleven = new Date("2026-08-17T02:00:00Z");

  it("accepts anywhere inside the intended hour", () => {
    assert.equal(isScheduledNow(11, 1, mondayEleven).ok, true);
    assert.equal(
      isScheduledNow(11, 1, new Date("2026-08-17T02:59:59Z")).ok,
      true
    );
  });

  it("rejects the hour either side of it", () => {
    assert.equal(isScheduledNow(11, 1, new Date("2026-08-17T01:59:59Z")).ok, false);
    assert.equal(isScheduledNow(11, 1, new Date("2026-08-17T03:00:00Z")).ok, false);
  });

  it("rejects the right hour on the wrong weekday", () => {
    // Same KST hour, one day later.
    assert.equal(isScheduledNow(11, 1, new Date("2026-08-18T02:00:00Z")).ok, false);
  });

  it("ignores the weekday when the job is daily", () => {
    assert.equal(isScheduledNow(11, undefined, new Date("2026-08-18T02:00:00Z")).ok, true);
  });
});

describe("scheduledSkipReason", () => {
  it("lets an unflagged run through whatever the time", () => {
    assert.equal(scheduledSkipReason([], 9), null);
    assert.equal(scheduledSkipReason(["--pages=10"], 9), null);
  });

  it("lets a --scheduled run through in exactly one hour of the day", () => {
    // This is the guard that makes a deploy-time pm2 registration a no-op.
    // It reads the real clock, so assert the shape rather than a verdict:
    // whatever hour it is, exactly one of the 24 slots may proceed.
    const passing = Array.from({ length: 24 }, (_, h) =>
      scheduledSkipReason(["--scheduled"], h)
    ).filter((r) => r === null);
    assert.equal(passing.length, 1);
  });

  it("names the slot it was expecting when it skips", () => {
    // Twelve hours from now is never the current hour.
    const otherHour = (kstClock().hour + 12) % 24;
    const reason = scheduledSkipReason(["--scheduled"], otherHour);
    assert.notEqual(reason, null);
    assert.match(reason as string, /Scheduled run skipped/);
    assert.match(reason as string, new RegExp(`${String(otherHour).padStart(2, "0")}:00-`));
  });
});
