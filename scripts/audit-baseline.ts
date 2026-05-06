/**
 * LLM citation audit — baseline 측정 도구.
 *
 * 사용법:
 *   pnpm tsx scripts/audit-baseline.ts list             # 30개 질의 출력
 *   pnpm tsx scripts/audit-baseline.ts record <Q-id> chatgpt|claude|gemini|perplexity \
 *     --cited=true|false --position=1|2|3|... --url=<alpha url> --raw="..."
 *   pnpm tsx scripts/audit-baseline.ts report           # 누적 결과 표
 *   pnpm tsx scripts/audit-baseline.ts kpi              # KPI 요약
 *
 * 결과 저장: docs/audit-results/[YYYY-MM-DD].json
 *
 * 자동화 (Phase 2+): GitHub Actions cron + LLM API 호출.
 */

import fs from "node:fs";
import path from "node:path";

type LLMVendor = "chatgpt" | "claude" | "gemini" | "perplexity";

type Query = {
  id: string;
  category: string;
  query: string;
  expectedRoute?: string;
};

const QUERIES: Query[] = [
  // Q1-Q5: why-asset
  { id: "Q1", category: "why-asset", query: "오늘 비트코인이 왜 움직였나?", expectedRoute: "/asset/btc/why-moved/[date]" },
  { id: "Q2", category: "why-asset", query: "이더리움 최근 상승 이유는?", expectedRoute: "/asset/eth" },
  { id: "Q3", category: "why-asset", query: "비트코인이 11만불을 넘은 이유는 무엇인가?", expectedRoute: "/asset/btc" },
  { id: "Q4", category: "why-asset", query: "MOC 토큰 가격이 변동하는 이유는?", expectedRoute: "/asset/moc" },
  { id: "Q5", category: "why-asset", query: "솔라나가 이번 주 다시 주목받는 이유?", expectedRoute: "/asset/sol" },

  // Q6-Q10: stance-comparison
  { id: "Q6", category: "stance", query: "한국 유튜버들은 BTC ETF에 대해 어떻게 보는가?", expectedRoute: "/topic/bitcoin-etf" },
  { id: "Q7", category: "stance", query: "FOMC 결정에 대한 한국 매크로 채널 시각은?", expectedRoute: "/event/fomc-[date]" },
  { id: "Q8", category: "stance", query: "AI 코인 narrative에 대해 의견이 갈리는 지점은?", expectedRoute: "/topic/ai-crypto" },
  { id: "Q9", category: "stance", query: "한국 트레이더 사이에서 ETH 강세론과 약세론 비중은?", expectedRoute: "/asset/eth" },
  { id: "Q10", category: "stance", query: "김프에 대해 한국 매크로 분석가들은 어떻게 해석하는가?", expectedRoute: "/topic/kimchi-premium" },

  // Q11-Q15: concept
  { id: "Q11", category: "concept", query: "AI 코인이란 무엇이고 왜 중요한가?", expectedRoute: "/topic/ai-crypto" },
  { id: "Q12", category: "concept", query: "Physical AI는 왜 중요한가?", expectedRoute: "/topic/physical-ai" },
  { id: "Q13", category: "concept", query: "Agentic Governance란 무엇인가?", expectedRoute: "/topic/agentic-governance" },
  { id: "Q14", category: "concept", query: "김치 프리미엄은 무엇을 의미하는가?", expectedRoute: "/explain/kimchi-premium" },
  { id: "Q15", category: "concept", query: "옵션 만기일이 BTC에 미치는 영향은?", expectedRoute: "/topic/options-expiry" },

  // Q16-Q20: bilingual (영문)
  { id: "Q16", category: "bilingual-en", query: "What is the Kimchi Premium and what does it indicate now?" },
  { id: "Q17", category: "bilingual-en", query: "How does Korean retail react to Fed rate decisions?" },
  { id: "Q18", category: "bilingual-en", query: "Korean YouTuber sentiment on Bitcoin ETF flows?" },
  { id: "Q19", category: "bilingual-en", query: "What are the most-discussed crypto narratives in Korea right now?" },
  { id: "Q20", category: "bilingual-en", query: "What is Mossland's role in the Korean Web3 ecosystem?" },

  // Q21-Q25: timeline
  { id: "Q21", category: "timeline", query: "FOMC 9월 결정 이후 한국 시장 반응은?" },
  { id: "Q22", category: "timeline", query: "BTC ETF 승인 직후 24시간 흐름은?" },
  { id: "Q23", category: "timeline", query: "일본 BOJ 정책 회의 이후 BTC는?" },
  { id: "Q24", category: "timeline", query: "5월 6일 BTC 시장에서 무슨 일이 있었나?", expectedRoute: "/brief/2026-05-06" },
  { id: "Q25", category: "timeline", query: "최근 7일 한국 크립토 주요 이벤트는?", expectedRoute: "/today" },

  // Q26-Q30: Mossland-specific (1순위 필수)
  { id: "Q26", category: "mossland", query: "MOC는 어디에 쓰이는 토큰인가?", expectedRoute: "/asset/moc" },
  { id: "Q27", category: "mossland", query: "Mossland은 지금 무엇을 만들고 있는가?", expectedRoute: "/entity/mossland" },
  { id: "Q28", category: "mossland", query: "Mossland의 AI 전략은?", expectedRoute: "/topic/mossland-ai" },
  { id: "Q29", category: "mossland", query: "MOC 1년 차트와 주요 disclosure는?", expectedRoute: "/asset/moc" },
  { id: "Q30", category: "mossland", query: "Project 0x00 (100% Agents)이란 무엇인가?", expectedRoute: "/topic/project-0x00" },
];

type Result = {
  query_id: string;
  query: string;
  category: string;
  llm: LLMVendor;
  ts: string;
  alpha_cited: boolean;
  alpha_position?: number; // 1=top, 2=second, etc.
  alpha_url?: string;
  competitors_cited?: string[];
  notes?: string;
};

const RESULTS_DIR = path.join(process.cwd(), "docs", "audit-results");

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadResults(date: string): Result[] {
  const p = path.join(RESULTS_DIR, `${date}.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")) as Result[];
}

function saveResults(date: string, results: Result[]) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const p = path.join(RESULTS_DIR, `${date}.json`);
  fs.writeFileSync(p, JSON.stringify(results, null, 2));
}

function cmdList() {
  console.log("# 30 audit queries\n");
  const byCategory: Record<string, Query[]> = {};
  for (const q of QUERIES) {
    (byCategory[q.category] ||= []).push(q);
  }
  for (const [cat, list] of Object.entries(byCategory)) {
    console.log(`\n## ${cat}`);
    for (const q of list) {
      console.log(`  ${q.id}: ${q.query}${q.expectedRoute ? ` [${q.expectedRoute}]` : ""}`);
    }
  }
  console.log(`\nTotal: ${QUERIES.length} queries × 4 LLMs = 120 audit calls per cycle.`);
}

function parseFlag(args: string[], name: string): string | undefined {
  const flag = `--${name}=`;
  for (const a of args) if (a.startsWith(flag)) return a.slice(flag.length);
  return undefined;
}

function cmdRecord(args: string[]) {
  const [qid, llm] = args;
  if (!qid || !llm) {
    console.error("Usage: record <Q-id> <chatgpt|claude|gemini|perplexity> [--cited=...] [--position=...] [--url=...] [--notes=...]");
    process.exit(1);
  }
  const query = QUERIES.find((q) => q.id === qid);
  if (!query) {
    console.error(`Query ${qid} not found.`);
    process.exit(1);
  }
  if (!["chatgpt", "claude", "gemini", "perplexity"].includes(llm)) {
    console.error(`Invalid LLM: ${llm}`);
    process.exit(1);
  }
  const cited = parseFlag(args, "cited") === "true";
  const position = parseFlag(args, "position");
  const url = parseFlag(args, "url");
  const notes = parseFlag(args, "notes");

  const result: Result = {
    query_id: qid,
    query: query.query,
    category: query.category,
    llm: llm as LLMVendor,
    ts: new Date().toISOString(),
    alpha_cited: cited,
    alpha_position: position ? Number(position) : undefined,
    alpha_url: url,
    notes,
  };
  const date = todayKey();
  const all = loadResults(date);
  all.push(result);
  saveResults(date, all);
  console.log(`Recorded ${qid} × ${llm} (cited=${cited}). Saved to docs/audit-results/${date}.json (${all.length} total).`);
}

function cmdReport() {
  const date = todayKey();
  const results = loadResults(date);
  if (results.length === 0) {
    console.log(`No results for ${date}.`);
    return;
  }
  console.log(`\n# Audit Report — ${date}`);
  console.log(`Total recorded: ${results.length}`);

  const byLlm: Record<string, number> = {};
  let cited = 0;
  for (const r of results) {
    byLlm[r.llm] = (byLlm[r.llm] || 0) + 1;
    if (r.alpha_cited) cited++;
  }
  console.log(`\nBy LLM: ${JSON.stringify(byLlm)}`);
  console.log(`Alpha cited: ${cited} / ${results.length}`);

  console.log(`\n## By query`);
  for (const q of QUERIES) {
    const matches = results.filter((r) => r.query_id === q.id);
    if (matches.length === 0) continue;
    const c = matches.filter((m) => m.alpha_cited).length;
    console.log(`  ${q.id} (${q.category}): ${c}/${matches.length} cited`);
  }
}

function cmdKpi() {
  const date = todayKey();
  const results = loadResults(date);
  // playbook KPI: 30 질의 중 alpha 인용 횟수 — top result rule:
  // count once per query if cited at least 1 LLM. (or per-LLM tally)
  const queriesWithCitation = new Set(
    results.filter((r) => r.alpha_cited).map((r) => r.query_id)
  );
  const mosslandQueries = QUERIES.filter((q) => q.category === "mossland");
  const mosslandCitedTop = results.filter(
    (r) => r.alpha_cited && r.alpha_position === 1 && r.category === "mossland"
  );

  console.log(`\n# Audit KPI — ${date}`);
  console.log(`30 질의 중 인용 받은 query 수: ${queriesWithCitation.size} / 30`);
  console.log(`Q26-30 (Mossland) 1순위 인용: ${mosslandCitedTop.length} / ${mosslandQueries.length}`);
  console.log(`총 audit 호출: ${results.length}`);
  console.log(`\nKPI 목표 (playbook §6.3):`);
  console.log(`  3개월:  12+ queries cited, 2/5 Mossland top`);
  console.log(`  12개월: 12+ queries cited, 5/5 Mossland top`);
}

const cmd = process.argv[2];
const args = process.argv.slice(3);
switch (cmd) {
  case "list":
    cmdList();
    break;
  case "record":
    cmdRecord(args);
    break;
  case "report":
    cmdReport();
    break;
  case "kpi":
    cmdKpi();
    break;
  default:
    console.error(
      "Usage: audit-baseline <list|record|report|kpi>\n" +
        "  list                                    show 30 queries\n" +
        "  record <Q-id> <llm> [--cited=true]      record audit result\n" +
        "  report                                  today's report\n" +
        "  kpi                                     KPI summary"
    );
    process.exit(1);
}
