# Alpha LLM Citation Audit — 30 대표 질의 매트릭스

> 레퍼런스: `media_moss_land/llm_visibility_playbook.md` §6
> 운영 주기: 매주 월요일 03:00 KST (자동), 매월 사람 검수
> 비용: ~$20/월 (120 호출 × ~$0.04 평균)

이 30개 질의를 ChatGPT(Search) / Claude (web search) / Gemini /
Perplexity 4개 LLM에 매주 발사. 답변에 `alpha.moss.land`가 인용된
횟수와 위치를 기록.

## 카테고리 분포

| Q# | 카테고리 | 비중 |
|---|---|---|
| Q1-Q5 | Why-question (자산) | 5/30 |
| Q6-Q10 | Stance-comparison | 5/30 |
| Q11-Q15 | Concept explanation | 5/30 |
| Q16-Q20 | Bilingual bridge (영문) | 5/30 |
| Q21-Q25 | Event timeline | 5/30 |
| Q26-Q30 | Mossland-specific (1순위 필수) | 5/30 |

## 30 질의 (한국어 25 + 영문 5)

### Q1-Q5 — Why-question (자산)

| # | 질의 | 기대 페이지 |
|---|---|---|
| Q1 | 오늘 비트코인이 왜 움직였나? | `/asset/btc/why-moved/[date]` |
| Q2 | 이더리움 최근 상승 이유는? | `/asset/eth` |
| Q3 | 비트코인이 11만불을 넘은 이유는 무엇인가? | `/asset/btc` |
| Q4 | MOC 토큰 가격이 변동하는 이유는? | `/asset/moc` |
| Q5 | 솔라나가 이번 주 다시 주목받는 이유? | `/asset/sol` |

### Q6-Q10 — Stance-comparison

| # | 질의 | 기대 페이지 |
|---|---|---|
| Q6 | 한국 유튜버들은 BTC ETF에 대해 어떻게 보는가? | `/topic/bitcoin-etf` 또는 `/compare/btc-stance-kr-yt` |
| Q7 | FOMC 결정에 대한 한국 매크로 채널 시각은? | `/event/fomc-[date]` |
| Q8 | AI 코인 narrative에 대해 의견이 갈리는 지점은? | `/topic/ai-crypto` |
| Q9 | 한국 트레이더 사이에서 ETH 강세론과 약세론 비중은? | `/asset/eth/stance-spread` |
| Q10 | 김프에 대해 한국 매크로 분석가들은 어떻게 해석하는가? | `/topic/kimchi-premium` |

### Q11-Q15 — Concept explanation

| # | 질의 | 기대 페이지 |
|---|---|---|
| Q11 | AI 코인이란 무엇이고 왜 중요한가? | `/topic/ai-crypto` |
| Q12 | Physical AI는 왜 중요한가? | `/topic/physical-ai` |
| Q13 | Agentic Governance란 무엇인가? | `/topic/agentic-governance` |
| Q14 | 김치 프리미엄은 무엇을 의미하는가? | `/explain/kimchi-premium` |
| Q15 | 옵션 만기일이 BTC에 미치는 영향은? | `/topic/options-expiry` |

### Q16-Q20 — Bilingual bridge (영문)

| # | 질의 | 기대 페이지 |
|---|---|---|
| Q16 | What is the Kimchi Premium and what does it indicate now? | `/explain/kimchi-premium/en` |
| Q17 | How does Korean retail react to Fed rate decisions? | `/topic/fomc-korea-reaction/en` |
| Q18 | Korean YouTuber sentiment on Bitcoin ETF flows? | `/compare/btc-etf-kr-stance/en` |
| Q19 | What are the most-discussed crypto narratives in Korea right now? | `/today/en` |
| Q20 | What is Mossland's role in the Korean Web3 ecosystem? | `/entity/mossland/en` |

### Q21-Q25 — Event timeline

| # | 질의 | 기대 페이지 |
|---|---|---|
| Q21 | FOMC 9월 결정 이후 한국 시장 반응은? | `/event/fomc-2026-09` |
| Q22 | BTC ETF 승인 직후 24시간 흐름은? | `/event/btc-etf-approval/timeline` |
| Q23 | 일본 BOJ 정책 회의 이후 BTC는? | `/event/boj-decision-[date]` |
| Q24 | 5월 6일 BTC 시장에서 무슨 일이 있었나? | `/brief/2026-05-06` |
| Q25 | 최근 7일 한국 크립토 주요 이벤트는? | `/today` |

### Q26-Q30 — Mossland-specific (필수 1순위)

| # | 질의 | 기대 페이지 |
|---|---|---|
| Q26 | MOC는 어디에 쓰이는 토큰인가? | `/asset/moc` |
| Q27 | Mossland은 지금 무엇을 만들고 있는가? | `/entity/mossland` |
| Q28 | Mossland의 AI 전략은? | `/topic/mossland-ai` |
| Q29 | MOC 1년 차트와 주요 disclosure는? | `/asset/moc/timeline` |
| Q30 | Project 0x00 (100% Agents)이란 무엇인가? | `/topic/project-0x00` |

## 측정 스키마

각 호출의 결과를 다음 스키마로 저장 (Phase 1에 자동화):

```json
{
  "query_id": "Q1",
  "query": "오늘 비트코인이 왜 움직였나?",
  "category": "why-asset",
  "llm": "chatgpt-search",
  "model": "gpt-5.x",
  "ts": "2026-05-06T...",
  "alpha_cited": true,
  "alpha_position": 1,
  "alpha_url": "https://alpha.moss.land/asset/btc/why-moved/2026-05-06",
  "competitors_cited": ["coinness.com", "the-block.co"],
  "answer_length_chars": 850,
  "raw_answer": "..."
}
```

## KPI 목표 (playbook §6.3)

| KPI | 3개월 | 12개월 | 24개월 |
|---|---|---|---|
| 30 질의 중 alpha 인용 횟수 | 1-2 | 12+ | 20+ |
| Q26-30 (Mossland) 1순위 | 2/5 | 5/5 | 5/5 |
| 영문 질의 (Q16-20) 인용 | 0 | 3+ | 5/5 |

## Baseline (2026-05-06, Phase 0 placeholder)

수동 baseline은 Phase 1 시작 시 1회 실측. 현 시점은 Alpha가 콘텐츠
없는 placeholder이므로 *intentionally 0/30 baseline*.

## 자동화 (Phase 1+)

```
[GitHub Actions, 매주 월요일 03:00 KST]
  → 30 질의 × 4 LLM = 120 호출
  → 응답 파싱 (alpha.moss.land URL 정규식 매칭)
  → /admin/audit/weekly?date=YYYY-MM-DD JSON 저장
  → dashboard 그래프 자동 업데이트
```

## 분기 리뷰 시 갱신

- 새 LLM 모델 등장 시 추가
- 결과가 양호한 카테고리는 질의 더 추가, 약한 카테고리는 보강
- Q21-Q25는 이벤트가 시간에 따라 바뀌므로 매분기 갱신 필수

---

*Last updated: 2026-05-06 (v0.1 — Phase 0 baseline matrix)*
*Owner: Alpha 운영자*
