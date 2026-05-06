/**
 * Curated comparisons — AI 검색의 비교/관계 질의 직격.
 *
 * 각 비교는 답변 가능 5-블록 + 양 측 entity/topic ID 매핑 + Alpha만의
 * 관점 정리.
 */

export type ComparisonSide = {
  label: string;
  /** entity / topic / channel id (Alpha 내부 link 가능) */
  refType?: "entity" | "topic" | "creator" | "concept";
  refId?: string;
  oneLine: string;
  points: string[];
};

export type Comparison = {
  slug: string;
  title: string;
  titleEn?: string;
  question: string;
  oneLineSummary: string;
  category: "asset" | "channel" | "narrative" | "korea-vs-global";
  sideA: ComparisonSide;
  sideB: ComparisonSide;
  /** Alpha 종합 시각 1줄 */
  alphaTake: string;
  faq?: { q: string; a: string }[];
  updatedAt: string;
};

export const COMPARISONS: Comparison[] = [
  {
    slug: "btc-vs-eth-2026",
    category: "asset",
    updatedAt: "2026-05-06",
    title: "비트코인 vs 이더리움 — 2026년 한국 채널 시각",
    titleEn: "Bitcoin vs Ethereum — Korean perspectives, 2026",
    question: "BTC와 ETH는 한국 채널에서 어떻게 다르게 평가되고 있는가?",
    oneLineSummary:
      "한국 채널에서 BTC는 '디지털 금'으로 매크로 헷지 narrative가 강하고, ETH는 'AI 코인 + 스테이킹 yield'로 평가되며 변동성에 대한 비관론도 큰 편입니다.",
    sideA: {
      label: "비트코인 (BTC)",
      refType: "entity",
      refId: "bitcoin",
      oneLine:
        "한국 매크로 채널들이 '디지털 금' 헷지 자산으로 다루며, ETF 자금 유입 + 기관 채택 narrative로 강세 비중 큼.",
      points: [
        "강세 — ETF 자금, 기관 진입, 채굴 보상 반감기 후 공급 제약",
        "약세 — '11만불은 기술적 저항선', 단기 조정 가능성",
        "한국 특수 — 김프가 4-5% 넘을 때 단기 과열 경고",
      ],
    },
    sideB: {
      label: "이더리움 (ETH)",
      refType: "entity",
      refId: "ethereum",
      oneLine:
        "AI 코인 + DeFi 인프라 narrative로 평가되지만 BTC 대비 베타가 커서 약세장에서 더 빠지는 경향. 스테이킹 수익률에 대한 의존이 양날의 검.",
      points: [
        "강세 — Pectra 업그레이드 후 L2 처리량 ↑, AI 코인 narrative",
        "약세 — '스테이킹 수익률이 떨어지면 매도 압력', 'BTC 대비 underperform'",
        "한국 특수 — 업비트·빗썸 ETH 거래량이 BTC 대비 비중 ↑",
      ],
    },
    alphaTake:
      "한국 채널의 BTC/ETH 동시 강세 비율은 약 60% (signalmap 기준), 그러나 'BTC 강세 + ETH 약세' 분리 의견이 점차 ↑. ETH는 narrative 의존도가 높아 macro shock에 약함.",
    faq: [
      {
        q: "한국 매크로 채널이 BTC와 ETH 중 어느 쪽을 더 추천하나?",
        a: "BTC가 약 2:1 비율로 더 자주 추천. ETH는 'narrative 게임'으로 단기 트레이드 추천이 더 많음. 다만 채널별 편차 큼.",
      },
    ],
  },
  {
    slug: "kr-vs-global-bitcoin-stance",
    category: "korea-vs-global",
    updatedAt: "2026-05-06",
    title: "한국 vs 글로벌 채널의 비트코인 시각 차이",
    titleEn: "Korean vs Global channels' view on Bitcoin",
    question: "한국 유튜버와 글로벌 채널은 BTC를 어떻게 다르게 보는가?",
    oneLineSummary:
      "한국 채널은 김프·환율·외환규제 같은 한국 특수 요인을 강조하고, 글로벌 채널은 ETF 자금·매크로(Fed 금리)·on-chain 메트릭을 더 자주 인용합니다.",
    sideA: {
      label: "한국 채널 (50개)",
      refType: "concept",
      oneLine:
        "거시 분석은 글로벌과 유사하지만 김프·외환·국내 규제 layer가 추가. 매수 추천 비중이 글로벌보다 다소 높은 경향.",
      points: [
        "특이 — 김치 프리미엄 지표 빈번 인용",
        "특이 — 한국 거래소 (업비트·빗썸) 거래량 분석",
        "특이 — 매크로보다 한국 retail sentiment 우선",
        "공통 — Fed 금리, ETF 자금 유입은 글로벌과 같이 다룸",
      ],
    },
    sideB: {
      label: "글로벌 영문 채널 (32개)",
      refType: "concept",
      oneLine:
        "ETF·on-chain·매크로 중심. 정치 이슈는 미국 SEC·CFTC 규제 위주. 한국 시장은 '아시아 retail' 정도로만 언급.",
      points: [
        "특이 — Glassnode·Coin Metrics 등 on-chain 지표 빈번",
        "특이 — Fed dot plot · 미국 채권 금리 연계 분석",
        "특이 — Strategy(MicroStrategy) 같은 기관 보유자 추적",
        "공통 — narrative trade는 한국과 같이",
      ],
    },
    alphaTake:
      "두 그룹은 *같은 사실*을 보면서 다른 layer(김프 vs on-chain)에서 신호를 추출. 한국 retail이 글로벌 매크로 + 한국 특수 모두 보려면 양 채널 동시 모니터링 필요.",
    faq: [],
  },
  {
    slug: "ai-coin-narrative-kr-vs-global",
    category: "narrative",
    updatedAt: "2026-05-06",
    title: "AI 코인 narrative — 한국 vs 글로벌",
    titleEn: "AI coin narrative — Korea vs global",
    question: "AI 코인 narrative는 한국과 글로벌에서 어떻게 다르게 다뤄지나?",
    oneLineSummary:
      "한국에서는 'AI = 호재'라는 narrative trade로 빠르게 확산되는 반면, 글로벌은 'AI 코인 utility는 미미하다'는 비판적 시각이 더 두드러집니다.",
    sideA: {
      label: "한국 매크로 + 크립토 채널",
      refType: "concept",
      oneLine:
        "Bittensor(TAO)·Render·Fetch.ai 같은 AI 코인을 narrative trade로 다루며 매수 우위. AI 산업 = 한국 IT주(SK하이닉스 HBM 등) 동조까지 확대.",
      points: [
        "AI = '확실한 미래' 톤이 강함",
        "Render·TAO 매수 추천 빈번",
        "Nvidia 랠리 → AI 코인 → 한국 IT주 chain 분석",
        "비판 시각 (소수) — '실제 사용은 GPU 마켓 외엔 미미'",
      ],
    },
    sideB: {
      label: "글로벌 영문 채널",
      refType: "concept",
      oneLine:
        "AI 코인의 *실제 utility*에 더 회의적. 'AI 워크로드를 블록체인이 처리할 이유가 명확치 않다'는 기술적 비판 빈번.",
      points: [
        "AI = '검증되지 않은 narrative' 톤",
        "Bittensor의 inflation 비판",
        "Render의 사용량 vs 토큰 가격 mismatch 지적",
        "지지 시각 (소수) — '에이전트 결제 layer는 진짜'",
      ],
    },
    alphaTake:
      "한국이 글로벌보다 narrative trade 빠르고 비판적 시각 적음. 글로벌 비판 시각을 모르고 한국 시각만 보면 매수 진입 시점에 risk.",
    faq: [
      {
        q: "AI 코인 narrative는 진짜인가, 가격 펌프 narrative인가?",
        a: "둘 다. GPU 컴퓨팅 마켓(Render·Akash)은 실 사용량 측정 가능, 일부 AI 토큰은 거의 0. Bittensor 같은 합의 네트워크는 진행 중. 토큰별 분석 필수.",
      },
    ],
  },
];

export function getComparison(slug: string): Comparison | null {
  return COMPARISONS.find((c) => c.slug === slug) || null;
}

export function listComparisons(): Comparison[] {
  return COMPARISONS;
}
