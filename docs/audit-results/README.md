# audit-results — 동결 아카이브 (2026-05)

이 디렉터리는 **읽기 전용 기록**입니다. 코드가 여기에 쓰지도, 여기서 읽지도 않습니다.

주간 LLM 인용 감사(`scripts/audit-auto.ts`, 매주 월 11:00 KST, gpt-4o web_search 30 질의)와
1회성 4-vendor 수동 기준선(`scripts/audit-baseline.ts`)이 2026-05-06/11/18 에 남긴 원본 JSON 입니다.
그 뒤의 주간 결과는 pm2 가 릴리스 워크트리를 cwd 로 잡아 이 상대경로에 쓰는 바람에 **배포마다
버려졌고**, 2026-08-18 에 출력 위치가 `AUDIT_RESULTS_DIR`(기본: DB 옆 `audit-results/`)로 옮겨졌습니다.

| 파일 | 출처 | 답변 | alpha.moss.land 인용 |
|---|---|---|---|
| `2026-05-06-auto.json` | audit-auto (gpt-4o) | 60 | 0 |
| `2026-05-06.json` | 수동 4-vendor 기준선 | 120 | 0 |
| `2026-05-11-auto.json` | audit-auto | 30 | 0 |
| `2026-05-18-auto.json` | audit-auto | 60 | 0 |

요약 행은 `alpha_audit_runs`(`lib/audit-log.ts`)에 `scripts/backfill-audit-runs.ts` 로 적재돼 `/health` 에
표시됩니다. **이 파일들은 그 0% 의 원본 증거라 남깁니다** — 질의별 인용 URL 과 답변 발췌(300자)는
"왜 0인가" 를 조사할 때 필요한 유일한 1차 자료입니다. 비밀은 없습니다(공개 API 응답의 URL 과 발췌).

- 새 결과를 여기 쓰지 마세요 — 두 스크립트 모두 `lib/audit-log.ts` `auditResultsDir()` 를 씁니다.
- 과거 JSON 을 새 위치로 다시 적재하려면: `pnpm tsx scripts/backfill-audit-runs.ts --dir docs/audit-results`
