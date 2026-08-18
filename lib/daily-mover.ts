/**
 * Daily mover snapshot — per-asset 24h |Δ| for the homepage.
 *
 * Pulses (signalmap) fire on intra-day spikes; on calm days they go
 * silent. Daily movers complement that by always showing *what* moved
 * over the past 24 hours, regardless of whether any spike crossed
 * threshold. Sources are public, key-free, identical to signalmap's
 * pulse-monitor (Binance + Yahoo) so no secrets to manage.
 *
 * Cache: alpha_daily_movers table, refreshed every 5 minutes (or on
 * demand). Stale data is served while a fresh fetch runs in the
 * background — the UI prefers "last seen 5min ago" over a hanging
 * request.
 */

import { getDb } from "./db";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const FETCH_TIMEOUT_MS = 8000;

export type DailyMover = {
  asset: string;          // BTC, ETH, KOSPI, USDKRW, ...
  label: string;          // 한국어 표기
  unit: "USD" | "KRW" | "pt";
  current: number;
  previous: number;       // 24h ago for crypto, prev close for stocks
  changePct: number;      // (current - previous) / previous * 100
  fetchedAt: string;      // ISO
  /** Source identifier for diagnostics */
  source: "binance" | "yahoo";
};

const ASSET_SPECS: Array<{
  asset: string;
  label: string;
  unit: "USD" | "KRW" | "pt";
  source: "binance" | "yahoo";
  symbol: string;
}> = [
  { asset: "BTC",     label: "비트코인",     unit: "USD", source: "binance", symbol: "BTCUSDT" },
  { asset: "ETH",     label: "이더리움",     unit: "USD", source: "binance", symbol: "ETHUSDT" },
  { asset: "SOL",     label: "솔라나",       unit: "USD", source: "binance", symbol: "SOLUSDT" },
  { asset: "KOSPI",   label: "코스피",       unit: "pt",  source: "yahoo",   symbol: "^KS11" },
  { asset: "KOSDAQ",  label: "코스닥",       unit: "pt",  source: "yahoo",   symbol: "^KQ11" },
  { asset: "USDKRW",  label: "원·달러",       unit: "KRW", source: "yahoo",   symbol: "KRW=X" },
  { asset: "QQQ",     label: "나스닥100",     unit: "USD", source: "yahoo",   symbol: "QQQ" },
  { asset: "SPY",     label: "S&P500",       unit: "USD", source: "yahoo",   symbol: "SPY" },
  { asset: "GLD",     label: "금 (GLD)",     unit: "USD", source: "yahoo",   symbol: "GLD" },
];

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_daily_movers (
      asset TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      unit TEXT NOT NULL,
      current REAL NOT NULL,
      previous REAL NOT NULL,
      change_pct REAL NOT NULL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);
}

function readCached(asset: string): DailyMover | null {
  ensureTable();
  const row = getDb()
    .prepare(
      `SELECT asset, label, unit, current, previous, change_pct, source, fetched_at
       FROM alpha_daily_movers WHERE asset = ?`
    )
    .get(asset) as
    | {
        asset: string;
        label: string;
        unit: "USD" | "KRW" | "pt";
        current: number;
        previous: number;
        change_pct: number;
        source: "binance" | "yahoo";
        fetched_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    asset: row.asset,
    label: row.label,
    unit: row.unit,
    current: row.current,
    previous: row.previous,
    changePct: row.change_pct,
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

function writeCache(m: DailyMover) {
  ensureTable();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO alpha_daily_movers
         (asset, label, unit, current, previous, change_pct, source, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(m.asset, m.label, m.unit, m.current, m.previous, m.changePct, m.source, m.fetchedAt);
}

async function fetchBinance24h(symbol: string): Promise<{ current: number; previous: number } | null> {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const j = (await res.json()) as { lastPrice?: string; openPrice?: string };
    const current = Number(j.lastPrice);
    const previous = Number(j.openPrice);
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
    return { current, previous };
  } catch {
    return null;
  }
}

/**
 * Largest acceptable gap between the last two daily bars.
 *
 * Measured bar-to-bar, not against the wall clock: a delisted or halted symbol
 * whose whole series is stale still has adjacent bars, while a genuine gap
 * this wide means we did not get consecutive sessions. 14 days clears Korea's
 * longest market closures (설·추석 plus adjacent weekends).
 */
const MAX_SESSION_GAP_MS = 14 * 24 * 3600_000;

async function fetchYahooQuote(symbol: string): Promise<{ current: number; previous: number } | null> {
  // Read the previous session close off the daily bar series, NOT
  // `meta.chartPreviousClose` — that field is the close *before the requested
  // range* (~5 sessions back at range=5d), so using it reported 5-day moves
  // under a "24h" label: KOSPI showed +13.67% against a real +2.62%, and QQQ
  // and KOSDAQ had their signs flipped. `meta.previousClose` is not returned
  // for these symbols, so the old `??` fallback never engaged.
  //
  // The last daily bar always belongs to the same session as
  // regularMarketPrice (Yahoo opens today's bar when the session starts), so
  // the bar before it is the previous close — true whether the market is open,
  // closed, or it is a weekend. range=1mo just guarantees two bars exist
  // across long holidays.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "alpha-daily-mover/0.1" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    const result = j.chart?.result?.[0];
    if (!result) return null;

    const current = Number(result.meta?.regularMarketPrice);
    if (!Number.isFinite(current)) return null;

    const stamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const bars = closes
      .map((close, i) => ({ close: Number(close), at: Number(stamps[i]) * 1000 }))
      .filter((b) => Number.isFinite(b.close) && b.close !== 0 && Number.isFinite(b.at));
    if (bars.length < 2) return null;

    const lastBar = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    // A gap this wide between the two most recent bars means they are not
    // consecutive sessions — drop the asset rather than publish a multi-day
    // move under a "24h" label, which is the bug this function exists to fix.
    if (lastBar.at - prevBar.at > MAX_SESSION_GAP_MS) return null;

    return { current, previous: prevBar.close };
  } catch {
    return null;
  }
}

async function fetchOne(spec: (typeof ASSET_SPECS)[number]): Promise<DailyMover | null> {
  const data =
    spec.source === "binance"
      ? await fetchBinance24h(spec.symbol)
      : await fetchYahooQuote(spec.symbol);
  if (!data) return null;
  const changePct = ((data.current - data.previous) / data.previous) * 100;
  const m: DailyMover = {
    asset: spec.asset,
    label: spec.label,
    unit: spec.unit,
    current: data.current,
    previous: data.previous,
    changePct,
    source: spec.source,
    fetchedAt: new Date().toISOString(),
  };
  writeCache(m);
  return m;
}

/** Get all daily movers, refreshing stale ones in parallel.
 *  Stale-while-revalidate: returns cached values immediately if any
 *  exist; refreshes in background only when CACHE_TTL_MS elapsed. */
export async function getDailyMovers(opts: { allowStale?: boolean } = {}): Promise<DailyMover[]> {
  ensureTable();
  const now = Date.now();
  const out: DailyMover[] = [];
  const toFetch: typeof ASSET_SPECS = [];

  for (const spec of ASSET_SPECS) {
    const cached = readCached(spec.asset);
    if (cached) {
      const age = now - Date.parse(cached.fetchedAt);
      if (age < CACHE_TTL_MS || opts.allowStale) {
        out.push(cached);
        if (age >= CACHE_TTL_MS) toFetch.push(spec);
        continue;
      }
    }
    toFetch.push(spec);
  }

  if (toFetch.length > 0) {
    const fresh = await Promise.all(toFetch.map((s) => fetchOne(s)));
    for (const m of fresh) {
      if (!m) continue;
      const idx = out.findIndex((x) => x.asset === m.asset);
      if (idx >= 0) out[idx] = m;
      else out.push(m);
    }
  }

  // Preserve ASSET_SPECS order
  out.sort(
    (a, b) =>
      ASSET_SPECS.findIndex((s) => s.asset === a.asset) -
      ASSET_SPECS.findIndex((s) => s.asset === b.asset)
  );
  return out;
}

export function fmtMoverPrice(m: Pick<DailyMover, "current" | "unit">): string {
  if (m.unit === "USD") {
    return m.current.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: m.current > 1000 ? 0 : 2,
    });
  }
  if (m.unit === "KRW") {
    return m.current.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "원";
  }
  return m.current.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " pt";
}
