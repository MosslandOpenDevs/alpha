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
