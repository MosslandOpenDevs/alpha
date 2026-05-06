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

/** entity ID → CoinGecko coin ID. 없으면 null. */
const ENTITY_TO_COINGECKO: Record<string, string> = {
  bitcoin: "bitcoin",
  ethereum: "ethereum",
  solana: "solana",
  mossland: "mossland",
  dogecoin: "dogecoin",
  cardano: "cardano",
  xrp: "ripple",
  usdt: "tether",
  usdc: "usd-coin",
};

export function coingeckoIdFor(entityId: string): string | null {
  return ENTITY_TO_COINGECKO[entityId.toLowerCase()] || null;
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
