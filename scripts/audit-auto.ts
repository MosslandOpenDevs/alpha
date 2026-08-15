/**
 * 자동 LLM citation audit — 30 질의를 OpenAI Responses API (web_search tool) 에 던지고
 * 응답 안의 url_citation annotations 에 alpha.moss.land 가 있는지 체크.
 *
 * 사용법:
 *   pnpm tsx scripts/audit-auto.ts                    # 30 질의
 *   pnpm tsx scripts/audit-auto.ts --limit=3          # 첫 3 질의만 (smoke test)
 *   pnpm tsx scripts/audit-auto.ts --query=Q26        # 단일 질의
 *   pnpm tsx scripts/audit-auto.ts --scheduled        # 월요일 11시 KST에만, 중복 제외
 *
 * 결과 저장: docs/audit-results/[YYYY-MM-DD]-auto.json
 *
 * 비용: gpt-4o + web_search 30 query ~$0.20-0.40 (web_search 호출당 fee 별도).
 *
 * 주: Grok Live Search 는 deprecated (Agent Tools API 로 전환 중). 이번 cycle 에서는
 *     OpenAI 만 자동 측정. 나중에 Anthropic / Perplexity 키 확보 시 추가.
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

type Query = {
  id: string;
  category: string;
  query: string;
};

const QUERIES: Query[] = [
  { id: "Q1", category: "why-asset", query: "오늘 비트코인이 왜 움직였나?" },
  { id: "Q2", category: "why-asset", query: "이더리움 최근 상승 이유는?" },
  { id: "Q3", category: "why-asset", query: "비트코인이 11만불을 넘은 이유는 무엇인가?" },
  { id: "Q4", category: "why-asset", query: "MOC 토큰 가격이 변동하는 이유는?" },
  { id: "Q5", category: "why-asset", query: "솔라나가 이번 주 다시 주목받는 이유?" },
  { id: "Q6", category: "stance", query: "한국 유튜버들은 BTC ETF에 대해 어떻게 보는가?" },
  { id: "Q7", category: "stance", query: "FOMC 결정에 대한 한국 매크로 채널 시각은?" },
  { id: "Q8", category: "stance", query: "AI 코인 narrative에 대해 의견이 갈리는 지점은?" },
  { id: "Q9", category: "stance", query: "한국 트레이더 사이에서 ETH 강세론과 약세론 비중은?" },
  { id: "Q10", category: "stance", query: "김프에 대해 한국 매크로 분석가들은 어떻게 해석하는가?" },
  { id: "Q11", category: "concept", query: "AI 코인이란 무엇이고 왜 중요한가?" },
  { id: "Q12", category: "concept", query: "Physical AI는 왜 중요한가?" },
  { id: "Q13", category: "concept", query: "Agentic Governance란 무엇인가?" },
  { id: "Q14", category: "concept", query: "김치 프리미엄은 무엇을 의미하는가?" },
  { id: "Q15", category: "concept", query: "옵션 만기일이 BTC에 미치는 영향은?" },
  { id: "Q16", category: "bilingual-en", query: "What is the Kimchi Premium and what does it indicate now?" },
  { id: "Q17", category: "bilingual-en", query: "How does Korean retail react to Fed rate decisions?" },
  { id: "Q18", category: "bilingual-en", query: "Korean YouTuber sentiment on Bitcoin ETF flows?" },
  { id: "Q19", category: "bilingual-en", query: "What are the most-discussed crypto narratives in Korea right now?" },
  { id: "Q20", category: "bilingual-en", query: "What is Mossland's role in the Korean Web3 ecosystem?" },
  { id: "Q21", category: "timeline", query: "FOMC 9월 결정 이후 한국 시장 반응은?" },
  { id: "Q22", category: "timeline", query: "BTC ETF 승인 직후 24시간 흐름은?" },
  { id: "Q23", category: "timeline", query: "일본 BOJ 정책 회의 이후 BTC는?" },
  { id: "Q24", category: "timeline", query: "5월 6일 BTC 시장에서 무슨 일이 있었나?" },
  { id: "Q25", category: "timeline", query: "최근 7일 한국 크립토 주요 이벤트는?" },
  { id: "Q26", category: "mossland", query: "MOC는 어디에 쓰이는 토큰인가?" },
  { id: "Q27", category: "mossland", query: "Mossland은 지금 무엇을 만들고 있는가?" },
  { id: "Q28", category: "mossland", query: "Mossland의 AI 전략은?" },
  { id: "Q29", category: "mossland", query: "MOC 1년 차트와 주요 disclosure는?" },
  { id: "Q30", category: "mossland", query: "Project 0x00 (100% Agents)이란 무엇인가?" },
];

type LlmReply = {
  answer: string;
  urls: string[];
  rawAnnotations?: unknown[];
  error?: string;
};

async function queryOpenAI(question: string): Promise<LlmReply> {
  if (!process.env.OPENAI_API_KEY) return { answer: "", urls: [], error: "no OPENAI_API_KEY" };
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        input: question,
        tools: [{ type: "web_search" }],
        tool_choice: { type: "web_search" },
      }),
    });
    if (!res.ok) {
      return { answer: "", urls: [], error: `${res.status}: ${(await res.text()).slice(0, 400)}` };
    }
    const data = (await res.json()) as {
      output?: {
        type?: string;
        content?: { type?: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[];
      }[];
    };
    let answer = "";
    const urls: string[] = [];
    const annotations: unknown[] = [];
    for (const out of data.output || []) {
      if (out.type !== "message") continue;
      for (const c of out.content || []) {
        if (c.type === "output_text") {
          answer += c.text || "";
          for (const a of c.annotations || []) {
            annotations.push(a);
            if (a.type === "url_citation" && a.url) urls.push(a.url);
          }
        }
      }
    }
    return { answer, urls, rawAnnotations: annotations };
  } catch (e) {
    return { answer: "", urls: [], error: (e as Error).message };
  }
}

function checkCitation(reply: LlmReply): {
  cited: boolean;
  position?: number;
  url?: string;
  inText?: boolean;
} {
  for (let i = 0; i < reply.urls.length; i++) {
    const u = reply.urls[i];
    if (u && /alpha\.moss\.land/i.test(u)) {
      return { cited: true, position: i + 1, url: u };
    }
  }
  const m = reply.answer.match(/alpha\.moss\.land[^\s'")\]\[]*/i);
  if (m) {
    return { cited: true, inText: true, url: m[0] };
  }
  return { cited: false };
}

type Result = {
  query_id: string;
  query: string;
  category: string;
  llm: "openai";
  ts: string;
  alpha_cited: boolean;
  alpha_position?: number;
  alpha_url?: string;
  alpha_in_text?: boolean;
  citations: string[];
  answer_excerpt: string;
  error?: string;
};

function parseFlag(args: string[], name: string): string | undefined {
  const flag = `--${name}=`;
  for (const a of args) if (a.startsWith(flag)) return a.slice(flag.length);
  return undefined;
}

async function main() {
  const { isScheduledNow } = await import("../lib/kst");
  const args = process.argv.slice(2);
  const scheduled = args.includes("--scheduled");
  const limit = Number(parseFlag(args, "limit") || QUERIES.length);
  const queryFilter = parseFlag(args, "query");
  if (!Number.isInteger(limit) || limit < 1 || limit > QUERIES.length) {
    throw new Error(`--limit must be an integer between 1 and ${QUERIES.length}`);
  }

  // Monday 11:00 KST — see lib/kst isScheduledNow() for why this exists.
  const { ok: onSchedule, clock } = isScheduledNow(11, 1);
  if (scheduled && !onSchedule) {
    console.log(
      `Scheduled audit skipped: ${clock.date} ${String(clock.hour).padStart(2, "0")}:xx KST is not Monday 11:00-11:59 KST.`
    );
    return;
  }

  const outDir = path.join(process.cwd(), "docs", "audit-results");
  const outFile = path.join(outDir, `${clock.date}-auto.json`);
  let existing: Result[] = [];
  if (fs.existsSync(outFile)) {
    existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
  }

  const completedQueryIds = scheduled
    ? new Set(
        existing
          .filter((result) => result.llm === "openai")
          .map((result) => result.query_id)
      )
    : new Set<string>();

  const queries = QUERIES.filter(
    (q) =>
      (!queryFilter || q.id === queryFilter) && !completedQueryIds.has(q.id)
  ).slice(0, limit);

  if (scheduled && queries.length === 0) {
    console.log(
      `Scheduled audit already complete for ${clock.date}; nothing to do.`
    );
    return;
  }

  console.log(`Audit: ${queries.length} queries × OpenAI gpt-4o (web_search).`);

  const results: Result[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    process.stdout.write(`  [${i + 1}/${queries.length}] ${q.id} ${q.query.slice(0, 50)}...\n`);

    const reply = await queryOpenAI(q.query);
    const cit = checkCitation(reply);
    results.push({
      query_id: q.id,
      query: q.query,
      category: q.category,
      llm: "openai",
      ts: new Date().toISOString(),
      alpha_cited: cit.cited,
      alpha_position: cit.position,
      alpha_url: cit.url,
      alpha_in_text: cit.inText,
      citations: reply.urls,
      answer_excerpt: reply.answer.slice(0, 300),
      error: reply.error,
    });
    const status = cit.cited
      ? `✅ cited${cit.position ? ` #${cit.position}` : " (text)"}`
      : reply.error
      ? `❌ ${reply.error.slice(0, 80)}`
      : "no";
    console.log(`    openai: ${status} (${reply.urls.length} cites)`);
    await new Promise((r) => setTimeout(r, 800));
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify([...existing, ...results], null, 2));

  // Summary
  const byVendor: Record<string, { cited: number; total: number }> = {};
  const queriesCited = new Set<string>();
  let mosslandCited = 0;
  for (const r of results) {
    byVendor[r.llm] ||= { cited: 0, total: 0 };
    byVendor[r.llm].total++;
    if (r.alpha_cited) {
      byVendor[r.llm].cited++;
      queriesCited.add(r.query_id);
      if (r.category === "mossland") mosslandCited++;
    }
  }

  console.log(`\n# Audit summary — ${clock.date}`);
  for (const [v, s] of Object.entries(byVendor)) {
    console.log(`  ${v}: ${s.cited}/${s.total} cited`);
  }
  console.log(
    `  Distinct queries cited: ${queriesCited.size} / ${queries.length}`
  );
  console.log(`  Mossland cited: ${mosslandCited}`);
  console.log(`\nSaved to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
