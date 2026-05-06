/**
 * FRED API 클라이언트 — St. Louis Fed Economic Data.
 *
 * 무료 (env FRED_API_KEY). 분 120 호출 제한.
 *
 * 캐시: alpha_macro_observations 테이블에 저장. 일 1회 갱신 (cron).
 * Production 운영: scripts/fetch-macro.ts가 매일 새 값 가져와 캐시.
 */

import { getDb } from "./db";

const FRED_API_BASE = "https://api.stlouisfed.org/fred";

export const FRED_AVAILABLE = !!process.env.FRED_API_KEY;

export type MacroSeries = {
  id: string;          // FRED series_id (e.g., "DFF")
  label: string;       // 한글 레이블
  labelEn: string;
  unit: string;        // "%", "USD", etc.
  freq: "D" | "W" | "M" | "Q" | "A"; // daily / weekly / monthly
  description: string;
};

/** 우리가 추적하는 핵심 series. */
export const MACRO_SERIES: MacroSeries[] = [
  {
    id: "DFF",
    label: "미 연방기금금리 (effective)",
    labelEn: "Federal Funds Rate",
    unit: "%",
    freq: "D",
    description: "미국 연준의 단기 정책금리. 매크로의 핵심 신호.",
  },
  {
    id: "FEDFUNDS",
    label: "미 연방기금금리 (월평균)",
    labelEn: "Federal Funds Rate (monthly)",
    unit: "%",
    freq: "M",
    description: "월평균 Federal Funds Rate.",
  },
  {
    id: "DGS10",
    label: "미 10년 국채 금리",
    labelEn: "10-Year Treasury",
    unit: "%",
    freq: "D",
    description: "장기 금리 + 시장의 인플레/성장 기대 종합.",
  },
  {
    id: "T10Y2Y",
    label: "미 10년-2년 스프레드",
    labelEn: "10Y-2Y Treasury Spread",
    unit: "%p",
    freq: "D",
    description: "마이너스면 경기침체 선행 지표 (역수익률 곡선).",
  },
  {
    id: "CPIAUCSL",
    label: "미 CPI (소비자물가)",
    labelEn: "Consumer Price Index",
    unit: "index",
    freq: "M",
    description: "전체 도시 소비자 가격 지수, 1982-84=100.",
  },
  {
    id: "UNRATE",
    label: "미 실업률",
    labelEn: "Unemployment Rate",
    unit: "%",
    freq: "M",
    description: "Fed의 dual mandate 한 축.",
  },
  {
    id: "DEXKOUS",
    label: "원/달러 환율",
    labelEn: "KRW/USD Exchange Rate",
    unit: "KRW",
    freq: "D",
    description: "한국 retail이 가장 신경쓰는 환율. (Fed 데이터지만 KR 매크로에 직결)",
  },
];

export type Observation = {
  series_id: string;
  date: string;     // YYYY-MM-DD
  value: number | null;
};

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_macro_observations (
      series_id TEXT NOT NULL,
      date TEXT NOT NULL,
      value REAL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (series_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_alpha_macro_series_date
      ON alpha_macro_observations(series_id, date DESC);
  `);
}

/** Fetch latest N observations from FRED, store in DB. */
export async function fetchSeriesLatest(seriesId: string, limit = 30): Promise<Observation[]> {
  if (!FRED_AVAILABLE) throw new Error("FRED_API_KEY not set");
  ensureTable();

  const url = new URL(`${FRED_API_BASE}/series/observations`);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", process.env.FRED_API_KEY!);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FRED ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    observations: { date: string; value: string }[];
  };

  const rows = data.observations
    .filter((o) => o.value !== "." && o.value !== "")
    .map((o) => ({
      series_id: seriesId,
      date: o.date,
      value: Number(o.value),
    }));

  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO alpha_macro_observations
       (series_id, date, value, fetched_at) VALUES (?, ?, ?, ?)`
  );
  const fetchedAt = new Date().toISOString();
  const tx = getDb().transaction((items: Observation[]) => {
    for (const it of items) {
      stmt.run(it.series_id, it.date, it.value, fetchedAt);
    }
  });
  tx(rows);

  return rows;
}

export function getLatestObservation(seriesId: string): Observation | null {
  ensureTable();
  const row = getDb()
    .prepare(
      `SELECT series_id, date, value FROM alpha_macro_observations
       WHERE series_id = ? AND value IS NOT NULL
       ORDER BY date DESC LIMIT 1`
    )
    .get(seriesId) as Observation | undefined;
  return row || null;
}

export function getRecentObservations(seriesId: string, limit = 30): Observation[] {
  ensureTable();
  return getDb()
    .prepare(
      `SELECT series_id, date, value FROM alpha_macro_observations
       WHERE series_id = ? AND value IS NOT NULL
       ORDER BY date DESC LIMIT ?`
    )
    .all(seriesId, limit) as Observation[];
}

/** 직전 값 대비 변화 (%p for rates, % change for indices). */
export function changeFromPrevious(
  series: { unit: string },
  obs: Observation[]
): { delta: number; deltaUnit: string } | null {
  if (obs.length < 2) return null;
  const cur = obs[0].value;
  const prev = obs[1].value;
  if (cur == null || prev == null) return null;
  if (series.unit === "%" || series.unit === "%p") {
    return { delta: cur - prev, deltaUnit: "%p" };
  }
  return { delta: ((cur - prev) / prev) * 100, deltaUnit: "%" };
}
