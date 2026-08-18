/**
 * Q&A SEO seeding — 큐레이티드 질의 50+개를 ask_alpha로 답변 → /ask/q/[hash] 영구 URL.
 *
 * 사용법:
 *   pnpm tsx scripts/seed-qa.ts                  # 모든 큐레이티드 질의
 *   pnpm tsx scripts/seed-qa.ts --dry-run        # 미답변 query 목록만 출력
 *
 * 비용: 50 질의 × $0.0002 = ~$0.01
 *
 * 주: ask_alpha는 캐시되어 동일 질의 재호출 0원.
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
process.env.NODE_ENV = process.env.NODE_ENV || "production";

const QUESTIONS = [
  // 자산 관련 (audit Q1-Q5)
  "오늘 비트코인이 왜 움직였나?",
  "이더리움 최근 상승 이유는?",
  "비트코인이 11만불을 넘은 이유는 무엇인가?",
  "MOC 토큰은 어디에 쓰이는가?",
  "솔라나가 다시 주목받는 이유?",
  "BTC와 ETH 중 어느 쪽이 한국 시장에서 더 강세인가?",
  "스테이블코인은 왜 중요한가?",
  "USDT와 USDC의 차이는?",

  // Stance comparison (audit Q6-Q10)
  "한국 유튜버들은 비트코인 ETF에 대해 어떻게 보는가?",
  "FOMC 결정에 대한 한국 매크로 채널 시각은?",
  "AI 코인 narrative에 대해 의견이 갈리는 지점은?",
  "한국 트레이더 사이에서 ETH 강세론과 약세론 비중은?",
  "김치 프리미엄에 대한 매크로 분석가들의 해석은?",
  "한국 채널들이 트럼프 정책을 어떻게 보고 있나?",

  // 개념 (audit Q11-Q15)
  "AI 코인이란 무엇이고 왜 중요한가?",
  "Physical AI는 왜 중요한가?",
  "Agentic Governance란 무엇인가?",
  "김치 프리미엄은 무엇을 의미하는가?",
  "옵션 만기일이 BTC에 미치는 영향은?",
  "비트코인 ETF는 무엇이고 어떻게 작동하나?",
  "한국은행 기준금리와 BTC는 어떻게 연결되나?",
  "FOMC dot plot은 무엇인가?",
  "yield curve가 마이너스가 되면 어떤 의미인가?",

  // Bilingual (audit Q16-Q20)
  "What is the Kimchi Premium and what does it indicate now?",
  "How does Korean retail react to Fed rate decisions?",
  "Korean YouTuber sentiment on Bitcoin ETF flows?",
  "What is Mossland and what does it build?",
  "What are the most-discussed crypto narratives in Korea right now?",

  // Timeline / Events (audit Q21-Q25)
  "FOMC 9월 결정 이후 한국 시장 반응은?",
  "BTC ETF 승인 직후 24시간 흐름은?",
  "일본 BOJ 정책 회의 이후 BTC는?",
  "최근 7일 한국 크립토 주요 이벤트는?",
  "호르무즈 해협 긴장이 BTC에 미치는 영향?",
  "이란 미사일 사건 이후 시장 반응은?",
  "OPEC UAE 탈퇴는 무엇을 의미하나?",
  "팀 쿡 사임 이후 애플은 어떻게 되나?",

  // Mossland (audit Q26-Q30)
  "MOC는 어디에 쓰이는 토큰인가?",
  "Mossland은 지금 무엇을 만들고 있는가?",
  "Mossland의 AI 전략은?",
  "MOC 1년 차트와 주요 disclosure는?",
  "Project 0x00 (100% Agents)이란 무엇인가?",
  "Mossland의 디지털 트윈은 어떻게 작동하나?",
  "Mossland Agora는 무엇인가?",

  // 광범위 매크로
  "시장에 영향을 주는 매크로 이슈는 무엇인가요?",
  "Fed가 금리를 올릴까 내릴까?",
  "달러 강세가 한국 자산에 미치는 영향은?",
  "원/달러 환율은 BTC와 어떻게 연결되나?",
  "미국 10년 국채 금리는 왜 중요한가?",
  "yield spread는 무엇을 의미하나?",

  // 정치 (audit과 연결)
  "최근 한국 정치 인물의 갈등은 어떤 게 있나?",
  "이재명 대통령 정책은 시장에 어떤 영향을 줄까?",
  "트럼프와 한국 정치는 어떻게 연결되나?",
  "한국 보수와 진보 채널의 시각 차이는?",

  // 한국 시장 전용
  "삼성전자 vs SK하이닉스, AI 반도체 경쟁은?",
  "코스피 7300 돌파 의미는?",
  "한국 IT주와 AI 코인은 어떻게 연결되나?",
  "업비트 김프와 글로벌 BTC 가격 차이는 왜?",

  // AI / 테크
  "엔비디아 GPU 부족이 AI 코인에 미치는 영향?",
  "OpenAI와 한국 IT 기업 관계는?",
  "AI 에이전트는 크립토에 어떤 변화를 주나?",

  // ─── Expansion v2 (2026-05-11) ────────────────────────────────
  // 더 많은 asset queries
  "비트코인 도미넌스가 하락하는 이유는?",
  "이더리움 ETF 승인 가능성은?",
  "솔라나 스테이킹 보상은 어떻게 되나?",
  "USDC와 USDT 중 어떤 게 더 안전한가?",
  "Tether 의존도 리스크는?",
  "리플(XRP) SEC 소송 결과 영향은?",
  "도지코인은 왜 다시 주목받는가?",
  "스테이블코인 규제는 어떻게 진행 중인가?",
  "비트코인 채굴 난이도 사상 최고치 의미는?",
  "이더리움 가스비 변동은 시장에 어떤 영향?",
  "BTC 90,000달러 돌파 가능성은?",
  "ETH 4,000달러 회복 시나리오는?",
  "솔라나 5,000달러 갈 수 있나?",
  "BTC 4년 사이클은 아직 유효한가?",
  "비트코인 ETF flows 가 어떻게 변하고 있나?",

  // Stance comparison 확장
  "한국 채널들의 BTC 강세론 vs 약세론 분포는?",
  "이더리움 ETF에 대한 한국 분석가들 시각은?",
  "솔라나에 대한 한국 트레이더 시각은?",
  "스테이블코인 사용에 대한 한국 시각은?",
  "AI 코인 펌프에 대한 회의론은 어디서 나오는가?",
  "한국 매크로 분석가들 사이 Fed 시각 차이는?",
  "트럼프 관세 정책에 대한 한국 시장 반응은?",
  "한국 채널들이 일본 BOJ 결정을 어떻게 보나?",
  "FOMC dot plot 해석 차이는?",
  "원/달러 1,500원대 진입에 대한 시각은?",
  "한국 채널들이 미국 대선 결과를 어떻게 해석하나?",
  "한국에서 이더리움 vs 솔라나 비교는 어떻게 나오나?",
  "한국 트레이더들의 단기 BTC 목표가 분포는?",

  // 개념 확장
  "Liquidity Pool 이란 무엇인가?",
  "Restaking 이란 어떤 개념인가?",
  "Layer 2 와 Layer 3 차이는?",
  "MEV(Maximal Extractable Value) 가 뭔가?",
  "Real World Assets(RWA) 토큰화란?",
  "Decentralized AI 란 어떤 개념인가?",
  "GMCI 30 인덱스란?",
  "옵션 감마 익스포저(GEX)란?",
  "Funding rate 가 가격에 미치는 영향은?",
  "Crypto Fear & Greed Index 해석법은?",
  "Bitcoin halving 이후 가격 패턴은?",
  "비트코인 코어 디벨로퍼는 어떻게 활동하나?",
  "Ethereum Pectra 업그레이드는 무엇을 바꾸나?",
  "한국 가상자산이용자보호법은 무엇을 규제하는가?",
  "DAO 거버넌스의 한계는?",

  // 한국 시장 전용 확장
  "한국 거래소 거래대금 1위는 어디인가?",
  "원화마켓 vs USDT마켓 차이는?",
  "한국 코인 시장의 김프 역사적 패턴은?",
  "한국 SVT(가상자산 거래소 자율규제) 영향은?",
  "코인원, 빗썸, 업비트 비교는?",
  "한국 코스피 vs 코스닥 AI 종목 비교는?",
  "한국 ETF 시장 성장 추이는?",
  "한국은행 CBDC 진행 상황은?",
  "한국 외환보유고와 가상자산은 어떻게 연결되나?",
  "삼성전자 HBM 시장 점유율 트렌드는?",
  "SK하이닉스 영업이익 사상 최고치 의미는?",
  "네이버, 카카오 AI 전략 차이는?",
  "한국 게임 토큰 (위메이드, 컴투스) 현황은?",
  "한국 NFT 시장 현황은?",
  "한국 STO 규제 현황은?",

  // Timeline / Events 확장
  "지난 24시간 BTC 시장 주요 이벤트는?",
  "지난 1주일 한국 채널 hot topic 은?",
  "지난 1개월 macro 주요 이벤트는?",
  "최근 BTC ETF 일간 flows 변동은?",
  "최근 Fed 인사들 발언 주요 포인트는?",
  "최근 SEC 가상자산 규제 동향은?",
  "최근 한국 가상자산 관련 입법 동향은?",
  "최근 코인베이스 vs Binance 시장 점유율은?",
  "최근 비트코인 미국 정부 보유 변동은?",
  "최근 1년간 BTC ATH 흐름은?",

  // Mossland / MOC 확장
  "MOC 토큰의 활용처는?",
  "Mossland Agora 거버넌스는 어떻게 작동하나?",
  "Mossland MAIT 가 하는 일은?",
  "Mossland Digital Twin 연구의 의미는?",
  "Project 0x00 의 비전은?",
  "Mossland 가 운영하는 disclosure 사이트는?",
  "Mossland 의 AI 페르소나 시스템 동작 원리는?",
  "Mossland Studio 의 역할은?",
  "Mossland 가 SignalMap 을 만든 이유는?",
  "MOC ERC-20 마이그레이션 의미는?",
  "Mossland 가 다른 메타버스 프로젝트와 다른 점은?",
  "Mossland CertiK 감사 결과는?",

  // Bilingual (영문) 확장
  "What is Korea's kimchi premium telling us about retail demand?",
  "How do Korean YouTubers cover Bitcoin ETF flows differently from US media?",
  "What is the Bank of Korea's stance on crypto?",
  "Are Korean institutions buying Bitcoin?",
  "What are the most-followed Korean crypto creators?",
  "How does Korean stock market correlate with BTC?",
  "What are KOSPI 7300 implications for global investors?",
  "How does Mossland's MOC token relate to its products?",
  "What is the Mossland Agora DAO?",
  "What MCP tools does alpha.moss.land expose?",
  "How does alpha.moss.land's persona system work?",
  "What is signalmap.moss.land?",
  "How do Korean exchanges handle stablecoins?",
  "What is the regulatory landscape for crypto in Korea in 2026?",
  "Why is Korean macro data important for Asia traders?",

  // AI / 테크 확장
  "Llama 4 출시는 어떤 영향을 미치나?",
  "Anthropic Claude 와 OpenAI GPT 의 시장 점유율은?",
  "Cursor, Cline, Continue 차이는?",
  "MCP (Model Context Protocol) 가 뭔가?",
  "MCP server 가 만드는 새로운 dev 패러다임은?",
  "Vibe coding 트렌드란?",
  "AI agent marketplace 현황은?",
  "RAG vs Fine-tuning 차이는?",
  "Open-source LLM 의 미래는?",
  "AI 칩 경쟁 (Nvidia vs AMD vs Apple) 현황은?",
  "한국 AI 스타트업 동향은?",
  "AI 페르소나 윤리는 어떻게 관리해야 하나?",
  "AI 트랙레코드 시스템의 의미는?",

  // 매크로 / 정세 확장
  "Fed 금리 인상 / 인하 시 자산별 반응은?",
  "달러 인덱스(DXY) 와 BTC 의 관계는?",
  "WTI 유가 변동이 한국 시장에 미치는 영향?",
  "BOJ 통화정책 결정의 글로벌 영향은?",
  "ECB 와 Fed 의 통화정책 차이는?",
  "중국 부동산 위기가 한국에 미치는 영향?",
  "미국-중국 무역 갈등 현황은?",
  "이란-이스라엘 긴장이 BTC 에 미치는 영향?",
  "북한 미사일 발사가 한국 시장에 미치는 영향?",
  "신흥국 통화 위기와 BTC 의 관계는?",
  "스태그플레이션 우려와 BTC?",
  "원자재 (구리, 금) 사이클과 크립토는?",
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const { askAlpha, getCachedAnswer, markQuestionSource } = await import("../lib/ask");

  console.log(`Total questions: ${QUESTIONS.length}`);
  let needGeneration = 0;
  for (const q of QUESTIONS) {
    if (!getCachedAnswer(q)) needGeneration++;
  }
  console.log(`Need generation: ${needGeneration} (cached: ${QUESTIONS.length - needGeneration})`);

  if (dryRun) {
    console.log("\nMissing:");
    for (const q of QUESTIONS) {
      if (!getCachedAnswer(q)) console.log("  -", q);
    }
    return;
  }

  let totalCost = 0;
  let success = 0;
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const existing = getCachedAnswer(q);
    if (existing) {
      // Already answered — but still assert provenance. Rows written before
      // alpha_questions had a `source` column defaulted to 'user', which
      // de-indexes them; this run is what puts curated questions back.
      markQuestionSource(q, "seed");
      cached++;
      continue;
    }
    process.stdout.write(
      `  [${i + 1}/${QUESTIONS.length}] ${q.slice(0, 50)}${q.length > 50 ? "..." : ""} ... `
    );
    try {
      const r = await askAlpha(q, { source: "seed" });
      success++;
      const len = r.answer.length;
      const cites = r.citations.length;
      process.stdout.write(`OK [${len}자, ${cites} citations]\n`);
      // ask_alpha 내부에서 cost 추적되지만 외부에서 못 가져옴 — Grok cache hit이면 0
    } catch (err) {
      failed++;
      process.stdout.write(`FAIL: ${(err as Error).message}\n`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(
    `\nDone. Created ${success}, cached ${cached}, failed ${failed}.`
  );
  console.log(
    `각 답변은 /ask/q/[hash] 영구 URL로 변환 + sitemap에 자동 포함 (quality_score ≥ 0.7).`
  );
  void totalCost;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
