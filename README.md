# Alpha — by Mossland

> 외부 유저가 매일 들어오는 미디어·커뮤니티·시그널 surface.
> `alpha.moss.land` (Phase 0)

이 repo는 **private**. Mossland 본진의 미디어 surface 실험 자산
(`signalmap.moss.land`, `media.moss.land`)을 흡수해서 통합 운영하는
다음 세대 surface.

## 3-pillar 정체성

```
Mossland Studio              = 모스랜드 공식 IR/PR/마케팅 (별도, 보류)
Alpha                        = 외부 유저 surface (이 repo)
Moss Intelligence Core (MIC) = SignalMap·media·Alpha가 공유하는 데이터·AI 백엔드
```

## 기획서

상위 기획 문서는 `media_moss_land/` 디렉토리에 있음 (외부):

- `service_plan.md` — Alpha 서비스 스펙
- `alpha_dev_plan.md` — 백엔드·SEO·인프라
- `llm_visibility_playbook.md` — LLM 인용 우위 운영 (continuous)
- `ir_pr_marketing.md` — Studio 운영 (별도, 보류)

## Phase 0 (현재 — alpha.moss.land가 살아있다)

- Next.js 16 + Tailwind v4 + Pretendard Variable
- `/robots.txt` (검색봇/사용자봇/학습봇 3분류)
- `/sitemap.xml` (seo_pages 단일 출처 기반)
- `/llms.txt` (LLM 친화 사이트 인덱스)
- `/rss.xml`
- JSON-LD `WebSite` + `Organization`
- `alpha_seo_pages` 단일 진실 출처 (SQLite, Postgres 호환 스키마)
- 답변 가능 5-블록 페이지 구조 (LLM citation friendly)

## 운영 정보

| 항목 | 값 |
|---|---|
| 포트 | 6900 |
| pm2 process | `alpha-web` |
| Lightsail nginx | Tailscale 직접 (`<LOCAL_TAILSCALE_IP>:6900`) |
| DB (production) | `<DB_PATH>` |
| 폰트 | Pretendard Variable (jsdelivr) + Source Serif 4 (Google Fonts) |

## 로컬 개발

```bash
pnpm install
pnpm dev      # http://localhost:6900
```

## 배포 (Mac mini)

```bash
cd <PROJECT_ROOT>
git pull && pnpm install && pnpm build
pm2 restart alpha-web
```

## License

Internal during operations.
