/**
 * Curated explainers — concept H1 질의 매칭 (audit Q11-15).
 *
 * 각 explainer는 답변 가능 5-블록 구조 + 영문 mirror 가능 (bilingual bridge).
 * 신규 explainer 추가 시 이 파일에만 추가 — 라우트는 자동.
 */

export type Explainer = {
  slug: string;
  title: string;
  titleEn?: string;
  question: string;
  oneLine: string;
  oneLineEn?: string;
  whyImportant: string;
  points: string[];
  /** 관련 canonical entity/topic ids — 자동 chip + internal link */
  relatedEntityIds?: string[];
  relatedTopicIds?: string[];
  faq?: { q: string; a: string }[];
  sources?: { title: string; url: string }[];
  category: "crypto" | "macro" | "korea" | "mossland" | "ai";
  updatedAt: string;
};

export const EXPLAINERS: Explainer[] = [
  {
    slug: "ai-crypto",
    category: "ai",
    updatedAt: "2026-05-06",
    title: "AI 코인이란 무엇이고 왜 중요한가?",
    titleEn: "What are AI coins and why do they matter?",
    question: "AI 코인이란 무엇이고 왜 중요한가?",
    oneLine:
      "AI 코인은 AI 모델 학습·추론·에이전트 운영에 사용되는 토큰 또는 AI 기반 프로젝트의 토큰을 통칭하며, 2024년 이후 크립토 시장에서 가장 강한 narrative 중 하나로 부상했습니다.",
    oneLineEn:
      "AI coins are tokens used for AI compute, inference, or agent operations — one of the strongest narratives in crypto since 2024.",
    whyImportant:
      "AI와 크립토의 결합은 (1) 분산된 GPU 컴퓨팅 마켓 (Render, Akash 등), (2) 에이전트 결제 (Truth Terminal, Project 0x00 류), (3) 데이터·모델 마켓플레이스 등 새 사용 사례를 만들고 있습니다. 한국 retail은 단순 narrative trade로 진입하는 경향이 강합니다.",
    points: [
      "확인된 사실 — Bittensor·Render·Fetch.ai 등이 시가총액 top 50 진입",
      "가능한 원인 — Nvidia랠리 + ChatGPT 대중화 + 에이전트 narrative",
      "다른 해석 — 일부 비관론자는 'AI 코인은 가격 펌프 narrative일 뿐 실사용 미미'",
      "연결 — 한국 IT주(삼성·SK하이닉스 HBM) 동조 가능성",
      "불확실 — 규제 (SEC가 일부 AI 토큰을 증권으로 분류 가능성)",
    ],
    relatedEntityIds: ["bitcoin", "ethereum"],
    relatedTopicIds: [],
    faq: [
      {
        q: "AI 코인 중 가장 큰 것은?",
        a: "시가총액 기준 Bittensor (TAO), Render (RNDR), Near (NEAR), Fetch.ai (FET) 등이 자주 거론됩니다. 다만 시장 사이클에 따라 순위 변동 큽니다.",
      },
      {
        q: "AI 코인은 일반 코인과 무엇이 다른가?",
        a: "기능적으로 GPU 컴퓨팅 결제·에이전트 보상·데이터 거래 등 AI 워크플로 결제에 쓰인다는 점이 차이입니다. 다만 실제 사용량은 프로젝트별로 큰 편차가 있습니다.",
      },
    ],
  },
  {
    slug: "kimchi-premium",
    category: "korea",
    updatedAt: "2026-05-06",
    title: "김치 프리미엄(김프)이란 무엇을 의미하는가?",
    titleEn: "What is the Kimchi Premium and what does it indicate?",
    question: "김치 프리미엄은 무엇을 의미하는가?",
    oneLine:
      "김치 프리미엄(김프)은 한국 거래소(업비트·빗썸 등)의 BTC 가격이 글로벌 거래소(Binance·Coinbase 등)보다 높은 비율을 의미하며, 한국 retail의 매수 압력 + 자금 이동 제약을 동시에 반영하는 지표입니다.",
    oneLineEn:
      "The Kimchi Premium is the price gap of BTC on Korean exchanges vs global, reflecting Korean retail buying pressure plus capital outflow restrictions.",
    whyImportant:
      "김프가 4-5%를 넘기면 (1) 한국 retail이 과열 상태, (2) 글로벌 자금이 차익 거래로 들어오기 어려움 (외환 규제), (3) 단기 조정 시그널일 수 있다고 해석됩니다. 매크로 분석가들이 한국 시장 sentiment 측정 지표로 자주 활용.",
    points: [
      "측정 = (한국 BTC/KRW를 USD로 환산) ÷ (글로벌 BTC/USD) − 1",
      "역사적으로 0% 근처 정상, 5%+면 과열, 10%+면 극단",
      "원화 외환 규제 때문에 글로벌 차익거래 자금 진입 제약",
      "한국 retail이 strong hand인지 weak hand인지의 signal",
      "마이너스 김프(역김프)는 한국 매도 압력 시그널",
    ],
    relatedEntityIds: ["bitcoin"],
    faq: [
      {
        q: "김프가 마이너스(역김프)면 무엇을 의미하나?",
        a: "한국 retail이 매도 압력이 강하다 → 한국 시장이 글로벌 대비 약세, 또는 한국 거래소에서 자금 이탈. 보통 약세장 후반부에 자주 관찰.",
      },
      {
        q: "김프와 BTC 가격의 상관관계는?",
        a: "단기 상승장에서 김프가 먼저 확대되고, 정점 근처에서 김프가 줄어드는 패턴이 종종 관찰됨. 그러나 후행 지표가 아니라 동행 지표로 보는 게 안전.",
      },
    ],
  },
  {
    slug: "physical-ai",
    category: "mossland",
    updatedAt: "2026-05-06",
    title: "Physical AI는 무엇이고 왜 중요한가?",
    titleEn: "What is Physical AI and why does it matter?",
    question: "Physical AI는 왜 중요한가?",
    oneLine:
      "Physical AI는 디지털 AI 모델이 물리 공간(센서·로봇·디지털 트윈)과 연결되어 실세계 행동을 추론·실행하는 영역으로, Mossland이 2026년 Q1부터 강하게 밀고 있는 narrative입니다.",
    oneLineEn:
      "Physical AI bridges digital AI models with physical space (sensors, robots, digital twins). Mossland has been pushing this narrative since 2026-Q1.",
    whyImportant:
      "Nvidia·Tesla·Boston Dynamics가 이미 큰 plays를 하고 있고, 토큰 프로젝트로는 Render·Akash 같은 컴퓨팅 마켓이 인접. Mossland은 디지털 트윈(Revit×Tandem)과 Mossverse를 연결해 자체 Physical AI surface를 구축 중.",
    points: [
      "확인 — Mossland 2026 Q1 Progress Note에서 Physical AI 명시",
      "가능 — Mossland의 Digital Twin + Mossverse가 Physical AI 백엔드 후보",
      "다른 시각 — 'Physical AI는 robotics 회사들의 영역, 토큰과 무관' 비판",
      "연결 — Mossland MAIT (DAO AI Toolkit), Project 0x00 (100% Agents) 와 narrative 일관",
      "불확실 — 토큰 utility가 어떤 형태로 발현될지 (스테이킹? 결제? 거버넌스?)",
    ],
    relatedTopicIds: [],
    sources: [
      {
        title: "Mossland Q1 2026 Progress Summary",
        url: "https://medium.com/mossland-blog/2026-q1-progress-summary",
      },
      {
        title: "Mossland 홈페이지 리뉴얼 소식",
        url: "https://medium.com/mossland-blog/mossland-website-renewal-update",
      },
    ],
  },
  {
    slug: "agentic-governance",
    category: "mossland",
    updatedAt: "2026-05-06",
    title: "Agentic Governance란 무엇인가?",
    titleEn: "What is Agentic Governance?",
    question: "Agentic Governance란 무엇인가?",
    oneLine:
      "Agentic Governance는 AI 에이전트가 DAO 거버넌스(투표·제안 분석·자동 실행)에 능동적으로 참여하는 모델로, Mossland은 Agora·MAIT·Project 0x00·bridge-2026 등으로 이 방향을 밀고 있습니다.",
    oneLineEn:
      "Agentic Governance is a model where AI agents actively participate in DAO governance (voting, proposal analysis, auto-execution). Mossland's Agora + MAIT + Project 0x00 are in this direction.",
    whyImportant:
      "전통 DAO는 사람의 투표 참여율이 낮아 거버넌스 marginalization 문제가 있었습니다. AI 에이전트가 발화·요약·심지어 투표까지 참여하면 (1) 참여율 ↑ (2) 의사결정 품질 ↑ (3) 그러나 권력 집중 risk라는 trade-off가 있습니다.",
    points: [
      "기본 — DAO 투표는 토큰 보유자의 권리; AI는 분석·요약 보조",
      "Mossland 진행 — MAIT가 제안서 요약 + 추천 (운영 중)",
      "Mossland 미래 — Project 0x00은 'agent-only' 시뮬레이션 환경",
      "비판 — AI가 결정에 개입하면 '제2의 중앙화' 우려",
      "불확실 — 어떤 단계까지 AI 권한을 줄지 (제안만? 추천? 자동 투표?)",
    ],
    relatedTopicIds: [],
    sources: [
      {
        title: "Mossland Disclosure",
        url: "https://disclosure.moss.land",
      },
    ],
  },
  {
    slug: "btc-etf",
    category: "crypto",
    updatedAt: "2026-05-06",
    title: "비트코인 ETF란 무엇이고 왜 중요한가?",
    titleEn: "What is a Bitcoin ETF and why does it matter?",
    question: "비트코인 ETF란 무엇이고 왜 중요한가?",
    oneLine:
      "비트코인 ETF(Exchange-Traded Fund)는 비트코인 가격에 연동된 상장지수펀드로, 2024년 1월 미국 SEC 승인 이후 기관 자금이 직접 BTC에 들어올 수 있는 통로가 됐습니다.",
    oneLineEn:
      "A Bitcoin ETF is a regulated fund tracking BTC price. Since SEC approval in Jan 2024, it became the main institutional on-ramp.",
    whyImportant:
      "ETF는 (1) 401(k)·기관 자금이 자체 KYC·custody 없이 BTC에 노출 가능 (2) BlackRock·Fidelity 같은 거대 펀드의 진입 (3) 주식처럼 거래되어 유동성 ↑. 한국에서는 직접 ETF 매수 어렵지만 글로벌 자금 흐름 시그널로 중요.",
    points: [
      "확인 — IBIT, FBTC 등이 2024-2025 누적 수십억 달러 자금 유입",
      "원인 — 2024년 1월 SEC 승인이 분기점",
      "다른 시각 — '기관 자금이 들어오면 변동성 ↓ + 가격 안정'",
      "비판 — 'BTC가 ETF에 의존하면 탈중앙 정신과 충돌'",
      "한국 — 직접 ETF 매수는 외환 제약, 글로벌 시그널로만 활용",
    ],
    relatedEntityIds: ["bitcoin"],
    faq: [
      {
        q: "한국에서 BTC ETF 직접 살 수 있나?",
        a: "한국 거래소에서는 BTC ETF 거래 X. 미국 주식 거래 가능한 한국 증권사(미래에셋·키움 등)에서 IBIT/FBTC 매수 가능하지만 외환 신고 절차 + 양도세 부담 필요.",
      },
    ],
  },
  {
    slug: "options-expiry",
    category: "crypto",
    updatedAt: "2026-05-06",
    title: "옵션 만기일이 BTC에 미치는 영향은?",
    titleEn: "How do options expiries affect BTC?",
    question: "옵션 만기일이 BTC에 미치는 영향은?",
    oneLine:
      "BTC 옵션 만기일(주로 매월 마지막 금요일, 분기 만기는 더 큰)에는 옵션 매도자의 헷지 청산 + 포지션 정리로 가격 변동성이 평소보다 커지는 경향이 있습니다.",
    oneLineEn:
      "BTC options expiries (last Friday of each month, larger on quarterly) tend to see higher volatility from hedge unwinds and position rebalancing.",
    whyImportant:
      "Deribit·CME 옵션 만기일에 (1) max pain 가격 근처로 가격이 수렴하는 경향 (2) 만기 후 다음 달 신규 포지션 형성으로 방향 전환 (3) 한국 retail은 김프 변동에 영향. 분기 만기(3·6·9·12월)는 영향력 더 큼.",
    points: [
      "메커니즘 — 옵션 매도자가 만기 직전 헷지 포지션 청산",
      "max pain — 옵션 거래자 손실이 가장 큰 가격 (BTC 가격이 그 근처로 수렴 경향)",
      "역사 — 2021-2025 분기 만기일 ±2% 변동 평균 (이상치 ±10%)",
      "한국 — 김프 변동성도 이 시점에 확대",
      "불확실 — 만기 효과는 후행적이라 의도적 트레이드는 risk 큼",
    ],
    relatedEntityIds: ["bitcoin"],
    faq: [
      {
        q: "옵션 만기일은 언제인가?",
        a: "Deribit 기준 매월 마지막 금요일 08:00 UTC. 분기 만기(3·6·9·12월)가 더 큰 미결제약정.",
      },
    ],
  },
];

export function getExplainer(slug: string): Explainer | null {
  return EXPLAINERS.find((e) => e.slug === slug) || null;
}

export function listExplainers(): Explainer[] {
  return EXPLAINERS;
}
