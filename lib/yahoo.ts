/**
 * Yahoo Finance chart client — the price source for everything that is not a
 * coin.
 *
 * Alpha's homepage has priced KOSPI, S&P500 and gold from this API since
 * launch (lib/daily-mover.ts). The trackable-call system could not: its only
 * price source was CoinGecko. That mismatch is the real reason calls starved
 * for three months — not a crash, and not a small mapping table. The assets
 * Alpha actually writes about are indices, commodities and semiconductors,
 * and none of them are on CoinGecko.
 *
 * Deliberately a separate module rather than a refactor of daily-mover.ts.
 * That file answers "what moved in the last session" and carries a
 * session-gap guard built for that question; this one answers "what was the
 * close on date X". Sharing a fetcher would mean editing the code path that
 * feeds the homepage for no gain. New Yahoo work belongs here.
 */

const TIMEOUT_MS = 8000;

/**
 * How far back to look for the last session on or before a target date.
 *
 * A 7-day call can settle on a weekend or a market holiday, so the target
 * date often has no bar of its own. 14 days clears Korea's longest closures
 * (설·추석 plus adjacent weekends) — the same span lib/daily-mover.ts uses to
 * judge whether two bars are consecutive sessions.
 */
const LOOKBACK_MS = 14 * 24 * 3600_000;

type Bar = { at: number; close: number };

async function fetchChart(
  symbol: string,
  query: string
): Promise<{ bars: Bar[]; current: number | null } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?${query}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "alpha-prices/0.1" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number };
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const r = j.chart?.result?.[0];
    if (!r) return null;
    const stamps = r.timestamp ?? [];
    const closes = r.indicators?.quote?.[0]?.close ?? [];
    const bars = closes
      .map((close, i) => ({ close: Number(close), at: Number(stamps[i]) * 1000 }))
      .filter(
        (b) => Number.isFinite(b.close) && b.close !== 0 && Number.isFinite(b.at)
      );
    // > 0, not just finite: a zero would pass through to a call's
    // reference_price and every later change would compute as ±Infinity.
    const current = Number(r.meta?.regularMarketPrice);
    return { bars, current: Number.isFinite(current) && current > 0 ? current : null };
  } catch {
    return null;
  }
}

/** Latest traded price. Falls back to the last daily close when the market is shut. */
export async function yahooCurrentPrice(symbol: string): Promise<number | null> {
  const c = await fetchChart(symbol, "interval=1d&range=5d");
  if (!c) return null;
  if (c.current != null) return c.current;
  return c.bars.length ? c.bars[c.bars.length - 1].close : null;
}

/**
 * The close on `date` (YYYY-MM-DD), or of the last session before it.
 *
 * Bars are compared against the end of the target day in UTC. Every symbol
 * mapped in lib/prices.ts opens at or after 00:00 UTC on its own calendar day
 * (KOSPI 09:00 KST = 00:00 UTC, US markets 13:30 or 14:30 UTC depending on
 * daylight time), so a UTC-date compare never picks up a session from the
 * following day.
 *
 * Yahoo opens the day's bar at the bell, so while that session is running the
 * bar holds the price so far, not a close. This function does not guard
 * against that; the caller must ask only once the day is over. lib/calls.ts
 * does — settlement waits a full day past target_date (SETTLE_DELAY_MS).
 */
export async function yahooCloseOn(
  symbol: string,
  date: string
): Promise<number | null> {
  const target = Date.parse(`${date}T23:59:59Z`);
  if (!Number.isFinite(target)) return null;
  const period1 = Math.floor((target - LOOKBACK_MS) / 1000);
  const period2 = Math.floor((target + 2 * 86400_000) / 1000);
  const c = await fetchChart(
    symbol,
    `interval=1d&period1=${period1}&period2=${period2}`
  );
  if (!c) return null;
  const onOrBefore = c.bars.filter((b) => b.at <= target);
  if (!onOrBefore.length) return null;
  return onOrBefore[onOrBefore.length - 1].close;
}
