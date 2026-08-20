/**
 * 이미 발행된 why-moved 기사의 색인 정책을 현재 게이트 기준으로 다시 매긴다.
 *
 * lib/why-moved.ts 의 articleWorthy() 는 2026-08-19 에 생겼다. 그 전에 만들어진
 * 기사 683건 중 357건은 5분 최대 변동 0.2%대·하루 순변화 1% 미만인 날의 것으로,
 * SignalMap 의 적응형 임계값이 조용한 장에서 발화한 것을 그대로 기사로 옮긴
 * 결과다. 전부 index_policy='index' 로 등록돼 sitemap 에 있다.
 *
 * 기사와 페이지는 그대로 둔다 — 지우면 이미 색인된 URL 이 404 가 되고 유입
 * 링크도 끊긴다. 색인 요청만 거둔다. 페이지의 robots 메타는 같은 판정
 * (whyMovedIndexPolicy) 에서 나오므로 head 와 sitemap 이 어긋나지 않는다.
 *
 * 멱등: 매번 현재 게이트로 다시 계산해 덮어쓴다. 게이트 상수를 조정한 뒤
 * 다시 돌리면 그 기준으로 재정렬된다.
 *
 * 사용법:
 *   pnpm tsx scripts/reindex-why-moved.ts --dry-run
 *   pnpm tsx scripts/reindex-why-moved.ts
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

async function main() {
  const dry = process.argv.includes("--dry-run");
  const { listAllWhyMoved, whyMovedIndexPolicy, articleWorthy } = await import("../lib/why-moved");
  const { getDb } = await import("../lib/db");
  const db = getDb();

  const articles = listAllWhyMoved();
  const update = db.prepare(
    `UPDATE alpha_seo_pages SET index_policy = ?, quality_score = ? WHERE path = ?`
  );
  const current = db.prepare(`SELECT index_policy FROM alpha_seo_pages WHERE path = ?`);

  let changed = 0;
  let missing = 0;
  const tally = { index: 0, noindex: 0 };
  for (const a of articles) {
    const policy = whyMovedIndexPolicy(a.pulses);
    tally[policy]++;
    const seoPath = `/asset/${a.asset}/why-moved/${a.date}`;
    const row = current.get(seoPath) as { index_policy: string } | undefined;
    if (!row) {
      missing++;
      continue;
    }
    if (row.index_policy === policy) continue;
    changed++;
    if (!dry) update.run(policy, articleWorthy(a.pulses) ? 0.85 : 0.3, seoPath);
  }

  console.log(
    `기사 ${articles.length}건 → index ${tally.index} · noindex ${tally.noindex}\n` +
      `${dry ? "(dry-run) " : ""}정책 변경 ${changed}건${missing ? ` · seo_pages 행 없음 ${missing}건` : ""}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
