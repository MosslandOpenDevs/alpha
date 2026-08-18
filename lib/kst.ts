/**
 * KST (UTC+9) wall-clock helpers.
 *
 * Korea has no daylight-saving transitions, so a fixed offset is exact and
 * needs no TZ database — and it stays correct whatever `TZ` the process was
 * started with, which matters because PM2 evaluates cron schedules in the
 * daemon's timezone (UTC on the production host) while the app presents
 * Korean market days.
 */
const KST_OFFSET_MS = 9 * 3600_000;

export type KstClock = {
  /** YYYY-MM-DD in KST */
  date: string;
  /** 0 = Sunday … 6 = Saturday, in KST */
  weekday: number;
  /** 0-23, in KST */
  hour: number;
};

export function kstClock(now: Date = new Date()): KstClock {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
  };
}

/**
 * Epoch bounds of a YYYY-MM-DD calendar date read as a KST day.
 *
 * KST midnight is 15:00 UTC of the previous day, so filtering a KST-labelled
 * day with UTC bounds silently shifts the window nine hours.
 */
export function kstDayBounds(date: string): { start: number; end: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  const midnightUtc = Date.parse(date + "T00:00:00Z");
  if (
    !Number.isFinite(midnightUtc) ||
    new Date(midnightUtc).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  const start = midnightUtc - KST_OFFSET_MS;
  return { start, end: start + 24 * 3600_000 };
}

/**
 * Guard for `--scheduled` cron runs.
 *
 * PM2 starts every app once the moment it is registered, so each redeploy
 * fires all crons off-schedule. Scripts that cost money or publish content
 * must therefore check that this really is their scheduled hour.
 *
 * @param hour     intended KST hour (the job may run anywhere in that hour)
 * @param weekday  optional KST weekday (0 = Sunday) for weekly jobs
 */
export function isScheduledNow(
  hour: number,
  weekday?: number,
  now: Date = new Date()
): { ok: boolean; clock: KstClock } {
  const clock = kstClock(now);
  const ok =
    clock.hour === hour && (weekday === undefined || clock.weekday === weekday);
  return { ok, clock };
}

/**
 * `--scheduled` in one line, for cron scripts.
 *
 * Returns a message to print and bail on when the flag is present but this is
 * not the job's slot; null when the run should go ahead. Scripts that spend
 * money or publish content need this, because `pm2 start ecosystem.config.cjs`
 * on every release fires each app once at whatever time the deploy happens.
 */
export function scheduledSkipReason(
  args: string[],
  hour: number,
  weekday?: number
): string | null {
  if (!args.includes("--scheduled")) return null;
  const { ok, clock } = isScheduledNow(hour, weekday);
  if (ok) return null;
  const hh = String(hour).padStart(2, "0");
  const slot = weekday === undefined ? `${hh}:00-${hh}:59 KST` : `weekday ${weekday} ${hh}:xx KST`;
  return (
    `Scheduled run skipped: ${clock.date} ${String(clock.hour).padStart(2, "0")}:xx KST ` +
    `(weekday ${clock.weekday}) is not the ${slot} slot.`
  );
}
