/**
 * CoinGecko free tier 클라이언트.
 *
 * 무료 무인증 (선택적 API key로 rate limit 상향 가능).
 * - 분 30 호출 (free no-key)
 * - 분 500 호출 (Demo key)
 *
 * 우리 entity ID → CoinGecko coin ID 매핑은 우리 SLUG_MAP 로직 그대로
 * (대부분 일치).
 */

const CG_API_BASE = "https://api.coingecko.com/api/v3";

export const COINGECKO_KEY = process.env.COINGECKO_API_KEY || "";

/**
 * entity ID → CoinGecko coin ID. 없으면 null.
 *
 * Every id here is verified against the live API, not inferred from the
 * ticker — CoinGecko has many coins per symbol and a wrong guess would price
 * a call against the wrong asset, which is worse than not pricing it. Add
 * entries only after `simple/price?ids=<id>` actually returns a quote.
 *
 * Coverage against the canonical store is reported by `assetCoverage()` and
 * surfaced on /health, because the previous silent version of this table is
 * how trackable calls starved for three months without anyone noticing.
 */
const ENTITY_TO_COINGECKO: Record<string, string> = {
  bitcoin: "bitcoin",
  ethereum: "ethereum",
  solana: "solana",
  mossland: "mossland",
  dogecoin: "dogecoin",
  cardano: "cardano",
  xrp: "ripple",
  chainlink: "chainlink",
  usdt: "tether",
  usdc: "usd-coin",
};

/**
 * Pegged assets: priceable, but not *callable*.
 *
 * A 7-day directional call on a dollar stablecoin always lands inside the ±1%
 * flat band, so it can never be right or wrong. Publishing one as a track
 * record entry is noise — the site shipped a "USDT ↓, 보합, −0.04%" call this
 * way. They stay in the price map so calls already on record still resolve.
 */
const PEGGED_ASSET_IDS = new Set(["usdt", "usdc"]);

export function coingeckoIdFor(entityId: string): string | null {
  return ENTITY_TO_COINGECKO[entityId.toLowerCase()] || null;
}

/** Can this asset carry a directional 7-day call worth publishing? */
export function isCallableAsset(entityId: string): boolean {
  const id = entityId.toLowerCase();
  return Boolean(ENTITY_TO_COINGECKO[id]) && !PEGGED_ASSET_IDS.has(id);
}

/**
 * How much of a set of asset entity ids this map actually covers.
 *
 * Callers pass the ids personas can post about; the gap is what quietly
 * caps the trackable-call supply.
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
    if (!ENTITY_TO_COINGECKO[id]) unmapped.push(id);
    else if (PEGGED_ASSET_IDS.has(id)) pegged.push(id);
    else callable.push(id);
  }
  return { total: assetEntityIds.length, callable, pegged, unmapped };
}

function headers(): HeadersInit {
  const h: HeadersInit = { Accept: "application/json" };
  if (COINGECKO_KEY) {
    (h as Record<string, string>)["x-cg-demo-api-key"] = COINGECKO_KEY;
  }
  return h;
}

/** 현재 USD 가격 — 빠른 접근. */
export async function getCurrentPrice(coingeckoId: string): Promise<number | null> {
  const url = `${CG_API_BASE}/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
  try {
    const res = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    return data[coingeckoId]?.usd ?? null;
  } catch {
    return null;
  }
}

/** 특정 날짜 USD 가격 (CoinGecko history endpoint). 일 단위. */
export async function getHistoricalPrice(
  coingeckoId: string,
  date: string // YYYY-MM-DD
): Promise<number | null> {
  // CoinGecko expects DD-MM-YYYY
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return null;
  const cgDate = `${d}-${m}-${y}`;
  const url = `${CG_API_BASE}/coins/${coingeckoId}/history?date=${cgDate}&localization=false`;
  try {
    const res = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      market_data?: { current_price?: { usd?: number } };
    };
    return data.market_data?.current_price?.usd ?? null;
  } catch {
    return null;
  }
}
