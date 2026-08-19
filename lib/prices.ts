/**
 * What an asset entity is worth, and whether it can carry a directional call.
 *
 * This used to live in lib/coingecko.ts, which meant "can this asset carry a
 * call" was answered by "is it a coin". It isn't. Measured on production
 * 2026-08-19, personas had written 76 top-level asset posts all-time; the
 * pages they landed on were 호르무즈 해협, GPU, HBM, S&P500 ETF, 금, 코스피,
 * 나스닥, 반도체. Of the three assets the coin map could actually price,
 * bitcoin had 2 posts (last 2026-05-06) and ethereum and xrp had none — ever.
 * In the 30 days to 2026-08-19, 9 top-level asset posts landed on 0 pages
 * this map could price. One of them — "S&P ATH에 AI 반도체가 동력?", agree,
 * 2026-08-18 — is exactly the call the system exists to record.
 *
 * So the call supply was not capped by a small table of coin ids. It was
 * capped by asking a crypto API to price a Korean equity index. The homepage
 * has quoted those same instruments every five minutes since launch
 * (lib/daily-mover.ts); only this system could not reach them.
 *
 * Every symbol here is verified against the live API before being added — the
 * rule the coin map already carried, and it matters more now that two sources
 * are in play: pricing a call against the wrong instrument is worse than not
 * pricing it. Verified 2026-08-19: ^KS11, ^GSPC, ^IXIC, SPY, GLD all return
 * bars; CoinGecko has no `strc`, and `sats` is ambiguous between the ordinals
 * token and the bitcoin unit, so both are left unmapped.
 */

import { getCurrentPrice, getHistoricalPrice } from "./coingecko";
import { yahooCloseOn, yahooCurrentPrice } from "./yahoo";

export type PriceSource = "coingecko" | "yahoo";

/**
 * `pegged` is a class, not a flag: it is priceable but never callable. A
 * 7-day directional call on a dollar stablecoin cannot be right or wrong, and
 * the site published a "USDT ↓, 보합, −0.04%" call before this was enforced.
 * They stay mapped so calls already on record keep settling.
 */
export type AssetClass = "crypto" | "index" | "commodity" | "pegged";

/**
 * What a quote is denominated in. Same three values lib/daily-mover.ts uses.
 * "pt" is index points — KOSPI 6,870 is not $6,870, and the track-record page
 * printed it that way until this was added.
 */
export type QuoteUnit = "USD" | "KRW" | "pt";

type Market = {
  source: PriceSource;
  symbol: string;
  klass: AssetClass;
  unit: QuoteUnit;
};

const MARKETS: Record<string, Market> = {
  // --- crypto (CoinGecko) ---
  bitcoin:   { source: "coingecko", symbol: "bitcoin",   klass: "crypto", unit: "USD" },
  ethereum:  { source: "coingecko", symbol: "ethereum",  klass: "crypto", unit: "USD" },
  solana:    { source: "coingecko", symbol: "solana",    klass: "crypto", unit: "USD" },
  mossland:  { source: "coingecko", symbol: "mossland",  klass: "crypto", unit: "USD" },
  dogecoin:  { source: "coingecko", symbol: "dogecoin",  klass: "crypto", unit: "USD" },
  cardano:   { source: "coingecko", symbol: "cardano",   klass: "crypto", unit: "USD" },
  xrp:       { source: "coingecko", symbol: "ripple",    klass: "crypto", unit: "USD" },
  chainlink: { source: "coingecko", symbol: "chainlink", klass: "crypto", unit: "USD" },
  usdt:      { source: "coingecko", symbol: "tether",    klass: "pegged", unit: "USD" },
  usdc:      { source: "coingecko", symbol: "usd-coin",  klass: "pegged", unit: "USD" },

  // --- indices and commodities (Yahoo) ---
  // Only stable, human-readable entity ids are mapped. The canonical store
  // also holds auto-generated ids like `entity-1ezu2mg` (필라델피아 반도체
  // 지수) which would fit here, but an id that an upstream pipeline can
  // regenerate could later point at a different entity — and then this table
  // would price a call against the wrong instrument, silently.
  kospi:       { source: "yahoo", symbol: "^KS11", klass: "index",     unit: "pt" },
  sp500:       { source: "yahoo", symbol: "^GSPC", klass: "index",     unit: "pt" },
  nasdaq:      { source: "yahoo", symbol: "^IXIC", klass: "index",     unit: "pt" },
  "sp500-etf": { source: "yahoo", symbol: "SPY",   klass: "index",     unit: "USD" },
  // GLD, not the GC=F front-month future: futures roll, and a roll inside a
  // 7-day window injects a price gap that has nothing to do with the call.
  // daily-mover.ts already quotes 금 through GLD for the same reason.
  gold:        { source: "yahoo", symbol: "GLD",   klass: "commodity", unit: "USD" },
};

/**
 * How small a 7-day move counts as 보합 (unscoreable), by asset class.
 *
 * A single ±1% band across all classes looked neutral but was not. Measured
 * over the last 2 years of daily closes — every 7-calendar-day move, |Δ|:
 *
 *     symbol      median |Δ|   inside ±1%   inside ±0.5%
 *     BTC-USD          3.41%        16.7%          9.1%
 *     ETH-USD          5.15%        12.6%          6.3%
 *     XRP-USD          5.18%        10.8%          5.9%
 *     ^KS11            2.64%        21.3%         13.0%
 *     ^IXIC            1.66%        29.8%         13.4%
 *     GLD              1.91%        27.6%         14.8%
 *     ^GSPC            1.15%        43.0%         21.8%
 *     SPY              1.17%        42.4%         22.8%
 *
 * At ±1% more than four in ten S&P500 calls would land unscoreable, against
 * roughly one in eight for crypto — the same published 적중률 computed off
 * very different samples. ±0.5% puts indices and commodities at 13–23%,
 * comparable to crypto's 11–17%, and "moved less than half a percent in a
 * week" is still a defensible definition of no move.
 *
 * The band in force is recorded on each call row, so changing these numbers
 * later cannot silently re-grade what was already published.
 */
export const FLAT_PCT_BY_CLASS: Record<AssetClass, number> = {
  crypto: 1,
  index: 0.5,
  commodity: 0.5,
  pegged: 1,
};

export function marketFor(entityId: string): Market | null {
  return MARKETS[entityId.toLowerCase()] ?? null;
}

/** Can this asset carry a directional 7-day call worth publishing? */
export function isCallableAsset(entityId: string): boolean {
  const m = marketFor(entityId);
  return m != null && m.klass !== "pegged";
}

/** The 보합 band for this asset, in percent. */
export function flatPctFor(entityId: string): number {
  const m = marketFor(entityId);
  return m ? FLAT_PCT_BY_CLASS[m.klass] : FLAT_PCT_BY_CLASS.crypto;
}

/**
 * A price for display, in the instrument's own unit.
 *
 * Unmapped ids format as USD: every call on record before this file existed
 * was a CoinGecko coin, so USD is what those rows mean. Sub-$10 quotes keep
 * four decimals (DOGE, XRP), everything else rounds to whole units.
 */
export function formatPrice(entityId: string, value: number): string {
  const unit = marketFor(entityId)?.unit ?? "USD";
  const digits = value < 10 ? 4 : 0;
  const n = value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (unit === "USD") return `$${n}`;
  if (unit === "KRW") return `₩${n}`;
  return `${n} pt`;
}

/** Price now, in the instrument's own quote currency. */
export async function currentPrice(entityId: string): Promise<number | null> {
  const m = marketFor(entityId);
  if (!m) return null;
  return m.source === "coingecko"
    ? getCurrentPrice(m.symbol)
    : yahooCurrentPrice(m.symbol);
}

/**
 * Price on a date (YYYY-MM-DD), for settling a call.
 *
 * Both sources are quoted in their own currency and a call is graded on
 * percentage change, so no FX conversion is involved — but reference and
 * resolution must come from the same source, which they do because both go
 * through this table.
 */
export async function priceOn(
  entityId: string,
  date: string
): Promise<number | null> {
  const m = marketFor(entityId);
  if (!m) return null;
  return m.source === "coingecko"
    ? getHistoricalPrice(m.symbol, date)
    : yahooCloseOn(m.symbol, date);
}

/**
 * How much of a set of asset entity ids can carry a call.
 *
 * `unmapped` is returned but is NOT a to-do list, and callers should not
 * publish its size as one. The canonical store's `asset` type is "thing that
 * is not a person, org, place or event", so the unmapped set on production
 * includes 호르무즈 해협, MetLife Stadium, 북극여우, 모르핀, RTX 2070 Super
 * and 천궁-II. A count of it reads as "39 assets waiting to be mapped" when
 * almost none of them have a price at all — /health said exactly that until
 * this was written.
 */
export function assetCoverage(assetEntityIds: string[]): {
  total: number;
  callable: string[];
  pegged: string[];
  unmapped: string[];
} {
  const callable: string[] = [];
  const pegged: string[] = [];
  const unmapped: string[] = [];
  for (const raw of assetEntityIds) {
    const id = raw.toLowerCase();
    const m = MARKETS[id];
    if (!m) unmapped.push(id);
    else if (m.klass === "pegged") pegged.push(id);
    else callable.push(id);
  }
  return { total: assetEntityIds.length, callable, pegged, unmapped };
}
