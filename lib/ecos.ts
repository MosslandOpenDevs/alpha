/**
 * 한국은행 ECOS API 클라이언트.
 *
 * 무료 (env ECOS_API_KEY). 일 10,000 호출 제한.
 *
 * URL 패턴:
 *   https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/{from}/{to}/{stat_code}/{cycle}/{start}/{end}/[{item_code}]
 *
 * KR 매크로 핵심 series:
 *   - 한국은행 기준금리 (722Y001/0101000, M, 연%)
 *   - 국고채 3년 (817Y002/010190000, D, 연%)
 *   - 원/달러 매매기준율 (731Y003/0000001, D, KRW)
 *   - 소비자물가지수 (901Y009/0, M, 2020=100)
 *
 * 같은 alpha_macro_observations 테이블 공유. series_id에 'KR_' prefix.
 */

import { getDb } from "./db";

const ECOS_API_BASE = "https://ecos.bok.or.kr/api/StatisticSearch";

export const ECOS_AVAILABLE = !!process.env.ECOS_API_KEY;

export type KrMacroSeries = {
  /** 우리 내부 ID (alpha_macro_observations.series_id) */
  id: string;
  /** ECOS STAT_CODE */
  statCode: string;
  /** ECOS ITEM_CODE1 (필수) */
  itemCode: string;
  label: string;
  labelEn: string;
  unit: string;
  /** ECOS CYCLE: D, M, Q, A */
  cycle: "D" | "M" | "Q" | "A";
  description: string;
};

export const KR_MACRO_SERIES: KrMacroSeries[] = [
  {
    id: "KR_BASE_RATE",
    statCode: "722Y001",
    itemCode: "0101000",
    label: "한국은행 기준금리",
    labelEn: "BoK Base Rate",
    unit: "%",
    cycle: "M",
    description:
      "한국은행 기준금리. 월 1회 금융통화위원회 결정. KR 매크로의 핵심 신호.",
  },
  {
    id: "KR_GOV3Y",
    statCode: "817Y002",
    itemCode: "010190000",
    label: "국고채 3년",
    labelEn: "KR 3Y Treasury",
    unit: "%",
    cycle: "D",
    description: "한국 국고채 3년물 금리. 시장의 단기 금리 기대 + 신용 사이클 신호.",
  },
  {
    id: "KR_USDKRW_BOK",
    statCode: "731Y003",
    itemCode: "0000001",
    label: "원/달러 매매기준율",
    labelEn: "KRW/USD (BoK)",
    unit: "KRW",
    cycle: "D",
    description: "한국은행 매매기준율. KR retail이 가장 주목하는 환율.",
  },
  {
    id: "KR_CPI",
    statCode: "901Y009",
    itemCode: "0",
    label: "소비자물가지수",
    labelEn: "KR CPI",
    unit: "index",
    cycle: "M",
    description: "소비자물가지수 (2020=100). 한국 인플레이션 핵심 지표.",
  },
];

export type EcosObservation = {
  series_id: string;
  date: string;
  value: number | null;
};

function ensureTable() {
  // FRED와 같은 테이블 공유 (lib/fred.ts에서 만든 것)
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_macro_observations (
      series_id TEXT NOT NULL,
      date TEXT NOT NULL,
      value REAL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (series_id, date)
    );
  `);
}

/** ECOS TIME 포맷을 ISO 날짜로 변환. */
function ecosTimeToDate(time: string, cycle: string): string {
  // M: YYYYMM → YYYY-MM-01
  // D: YYYYMMDD → YYYY-MM-DD
  // Q: YYYYQ1 → 분기 첫달 1일
  // A: YYYY → YYYY-01-01
  if (cycle === "D" && time.length === 8) {
    return `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`;
  }
  if (cycle === "M" && time.length === 6) {
    return `${time.slice(0, 4)}-${time.slice(4, 6)}-01`;
  }
  if (cycle === "Q" && time.length === 5) {
    const q = Number(time[4]);
    const month = ((q - 1) * 3 + 1).toString().padStart(2, "0");
    return `${time.slice(0, 4)}-${month}-01`;
  }
  if (cycle === "A" && time.length === 4) {
    return `${time}-01-01`;
  }
  return time; // fallback
}

/** Compute date range to fetch — 최근 60 단위. */
function defaultRange(cycle: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10).replace(/-/g, "");
  const startDate = new Date(now);

  if (cycle === "D") {
    startDate.setDate(startDate.getDate() - 90);
    return { start: startDate.toISOString().slice(0, 10).replace(/-/g, ""), end };
  }
  if (cycle === "M") {
    startDate.setMonth(startDate.getMonth() - 36);
    return {
      start: startDate.toISOString().slice(0, 7).replace("-", ""),
      end: end.slice(0, 6),
    };
  }
  // 기본: 1년치
  startDate.setFullYear(startDate.getFullYear() - 2);
  return { start: startDate.toISOString().slice(0, 4), end: end.slice(0, 4) };
}

export async function fetchKrSeries(s: KrMacroSeries): Promise<EcosObservation[]> {
  if (!ECOS_AVAILABLE) throw new Error("ECOS_API_KEY not set");
  ensureTable();

  const { start, end } = defaultRange(s.cycle);
  // ECOS URL: /StatisticSearch/{key}/json/kr/{from}/{to}/{stat_code}/{cycle}/{start}/{end}/{item_code}
  const url = `${ECOS_API_BASE}/${process.env.ECOS_API_KEY}/json/kr/1/200/${s.statCode}/${s.cycle}/${start}/${end}/${s.itemCode}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ECOS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    StatisticSearch?: {
      list_total_count?: number;
      row?: { TIME: string; DATA_VALUE: string }[];
    };
    RESULT?: { CODE?: string; MESSAGE?: string };
  };

  if (data.RESULT?.CODE && data.RESULT.CODE !== "INFO-200" && data.RESULT.CODE !== "INFO-100") {
    throw new Error(`ECOS error: ${data.RESULT.CODE} ${data.RESULT.MESSAGE}`);
  }

  const rows = data.StatisticSearch?.row || [];
  const observations = rows
    .filter((r) => r.DATA_VALUE && r.DATA_VALUE !== "-")
    .map((r) => ({
      series_id: s.id,
      date: ecosTimeToDate(r.TIME, s.cycle),
      value: Number(r.DATA_VALUE),
    }))
    .filter((o) => Number.isFinite(o.value));

  if (observations.length === 0) return [];

  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO alpha_macro_observations
       (series_id, date, value, fetched_at) VALUES (?, ?, ?, ?)`
  );
  const fetchedAt = new Date().toISOString();
  const tx = getDb().transaction((items: EcosObservation[]) => {
    for (const it of items) stmt.run(it.series_id, it.date, it.value, fetchedAt);
  });
  tx(observations);

  return observations;
}
