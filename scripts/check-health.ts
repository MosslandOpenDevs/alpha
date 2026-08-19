/**
 * /health 스모크 체크 — 배포 전 1회 실행.
 *
 * `getSystemHealth()` 는 여러 테이블에 raw SQL 을 던지는데, 그 SQL 은 문자열
 * 리터럴이라 `tsc` 도 `next build` 도 검증하지 못한다. 실제로 존재하지 않는
 * 컬럼(`alpha_brief_translations.generated_at`)을 읽는 쿼리가 두 검사를 모두
 * 통과한 적이 있다. lib/health.ts 의 row() 헬퍼는 "no such table" 만 삼키므로
 * 컬럼 오타는 예외로 터져 /health 와 /api/health?detail=1 이 통째로 500 이 된다.
 *
 * 빈 DB 로는 잡히지 않는다 — 테이블이 없으면 "no such table" 로 삼켜지기
 * 때문이다. 그래서 각 모듈의 테이블 생성 경로를 먼저 태워 스키마를 만든 뒤
 * 조회한다.
 *
 * 사용법:
 *   pnpm tsx scripts/check-health.ts          # 임시 DB 에 스키마 만들고 검사
 *   DB_PATH=<운영 DB> pnpm tsx scripts/check-health.ts --live   # 운영 DB 읽기
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const live = process.argv.includes("--live");

  let tmpDir: string | null = null;
  if (!live) {
    // 운영 DB 를 건드리지 않도록 임시 파일로 격리한다.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-health-"));
    process.env.DB_PATH = path.join(tmpDir, "check.sqlite");
  }
  if (!process.env.DB_PATH) {
    console.error("DB_PATH 가 필요합니다.");
    process.exit(2);
  }
  process.env.NODE_ENV = process.env.NODE_ENV || "production";

  try {
    if (!live) {
      // 각 subsystem 의 테이블을 만든다. 스키마가 있어야 컬럼 오타가 드러난다.
      // Every table getSystemHealth() queries must exist here, or a column
      // typo in that query is swallowed as "no such table" and this gate
      // passes it. synthesis / macro / connections were missing from this
      // list — three of the health queries were never actually smoke-tested.
      const [
        community, calls, brief, translate, whyMoved, ai, rate, heartbeat,
        synthesis, fred, connections,
      ] = await Promise.all([
        import("../lib/community"),
        import("../lib/calls"),
        import("../lib/brief"),
        import("../lib/brief-translate"),
        import("../lib/why-moved"),
        import("../lib/grok"),
        import("../lib/rate-limit"),
        import("../lib/cron-heartbeat"),
        import("../lib/synthesis"),
        import("../lib/fred"),
        import("../lib/connections"),
      ]);
      community.ensureCommunityTables();
      calls.getHandleStats("__schema__");
      brief.getBriefSummary("2026-01-01");
      translate.getBriefEn("2026-01-01");
      whyMoved.getWhyMoved("bitcoin", "2026-01-01");
      ai.todayAiSpendUsd();
      rate.rateLimitSnapshot();
      heartbeat.getAllHeartbeats();
      synthesis.getSynthesis("entity", "__schema__");
      fred.getLatestObservation("__schema__");
      connections.getConnection("__a__", "__b__");
    }

    const { getSystemHealth } = await import("../lib/health");
    const health = getSystemHealth();

    console.log(`worstStatus: ${health.worstStatus}`);
    for (const s of health.subsystems) {
      console.log(`  ${s.key.padEnd(22)} ${s.status}`);
    }
    console.log(
      `cost: $${health.costBudget.costUsd.toFixed(4)} / $${health.costBudget.capUsd.toFixed(2)}` +
        ` · pipeline $${health.costBudget.pipelineCostUsd.toFixed(4)}`
    );
    console.log(`\n✓ getSystemHealth() OK — ${health.subsystems.length} subsystems`);
  } catch (err) {
    console.error("\n✗ getSystemHealth() 실패 — /health 와 /api/health 가 500 이 됩니다.");
    console.error(err);
    process.exit(1);
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
