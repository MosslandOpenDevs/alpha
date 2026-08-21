/**
 * AI 페르소나 일일 tick — 매일 N 페이지에 페르소나 발화 추가.
 *
 * 사용법:
 *   pnpm tsx scripts/persona-tick.ts                  # default: 10 페이지
 *   pnpm tsx scripts/persona-tick.ts --pages=5
 *   pnpm tsx scripts/persona-tick.ts --types=entity,asset
 *   pnpm tsx scripts/persona-tick.ts --scheduled          # 09시 KST 에만 실행
 *
 * pm2 cron: 매일 23:00 UTC = 다음날 08:00 KST.
 *
 * 알고리즘:
 *   - 활성 entity/topic/event 후보군 (videoCount ≥ 3)
 *   - 페르소나가 아직 발화 안 한 페이지 우선
 *   - 일일 cap 안 찬 페르소나 중 랜덤
 *   - 사람 댓글 5+ 페이지는 skip (HN decay)
 */

import { loadScriptEnv } from "../lib/script-env";

loadScriptEnv();

function parseFlag(args: string[], name: string): string | undefined {
  const flag = `--${name}=`;
  for (const a of args) if (a.startsWith(flag)) return a.slice(flag.length);
  return undefined;
}

/** Intended KST hour of the pm2 cron (09:00 KST = 00:00 UTC). */
const SCHEDULED_KST_HOUR = 9;

/**
 * How many priceable-asset posts a KST day may publish.
 *
 * A ceiling on published posts, not on candidates offered — see the pool
 * build below. Bounded by the 30-day (persona, page) cooldown: 8 priceable
 * assets × 8 personas ÷ 30 days ≈ 2.1 sustainable draws a day.
 */
const CALLABLE_ASSET_QUOTA = 2;

async function main() {
  const args = process.argv.slice(2);

  // PM2 starts every app once the moment it is registered, so a redeploy
  // would publish a full tick of persona posts off-schedule. --scheduled
  // makes that registration run a no-op outside the intended hour.
  if (args.includes("--scheduled")) {
    const { isScheduledNow } = await import("../lib/kst");
    const { ok, clock } = isScheduledNow(SCHEDULED_KST_HOUR);
    if (!ok) {
      console.log(
        `Scheduled tick skipped: ${clock.date} ${String(clock.hour).padStart(2, "0")}:xx KST is not ${String(SCHEDULED_KST_HOUR).padStart(2, "0")}:00-${String(SCHEDULED_KST_HOUR).padStart(2, "0")}:59 KST.`
      );
      return;
    }
  }

  const pages = Number(parseFlag(args, "pages") ?? "10");
  if (!Number.isInteger(pages) || pages < 1 || pages > 100) {
    throw new Error("--pages must be an integer between 1 and 100");
  }

  const validTypes = new Set(["entity", "asset", "topic", "event"] as const);
  const requestedTypes = (parseFlag(args, "types") ?? "entity,asset,topic,event")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const invalidTypes = requestedTypes.filter(
    (value) => !validTypes.has(value as "entity" | "asset" | "topic" | "event")
  );
  if (requestedTypes.length === 0 || invalidTypes.length > 0) {
    throw new Error(`--types contains invalid values: ${invalidTypes.join(", ")}`);
  }
  const selectedTypes = new Set(requestedTypes);

  const { getActiveAgents } = await import("../lib/agents");
  const { generatePersonaPost, PERSONA_POOL_MIN_VIDEO_COUNT, hasEnoughPageContext } =
    await import("../lib/persona-post");
  const { getAllEntities, getAllTopics, getAllEvents, getStubAssetEntities } =
    await import("../lib/mic");

  const agents = getActiveAgents();
  const today = new Date().toISOString().slice(0, 10);

  // Already done today? Then this run has nothing to add.
  //
  // A deploy swap re-registers every cron app and pm2 runs each one once,
  // immediately. Every other cron survives that — brief is keyed by date,
  // why-moved compares pulse sets, calls skips posts that already have one —
  // but this one had no such guard, so a swap inside the 09:00 KST hour
  // published a second full round of ten. That is the whole reason
  // DEPLOY_QUIET_HOURS_KST blocks 09 and 12 (scripts/deploy.sh), which costs
  // up to two hours of deploy latency every day.
  //
  // Counting what today already has also makes a partial run resumable: if the
  // process died after four posts, the next invocation writes six, not ten.
  const { getDb } = await import("../lib/db");
  const postedToday = (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM alpha_posts
         WHERE author_kind = 'agent' AND parent_id IS NULL AND is_deleted = 0
           AND datetime(created_at, '+9 hours') >= date('now', '+9 hours')`
      )
      .get() as { n: number }
  ).n;
  if (postedToday >= pages) {
    console.log(`Tick ${today}: already posted ${postedToday}/${pages} today — nothing to do.`);
    return;
  }
  const remaining = pages - postedToday;

  // Build candidate pool — entity/topic/event with videoCount ≥ 3
  type Candidate = { refType: "entity" | "topic" | "event" | "asset"; refId: string };
  const pool: Candidate[] = [];
  // Stub assets included: they have live pages, just no canonical row yet.
  // hasEnoughPageContext() is what keeps the empty ones out.
  let skippedPersons = 0;
  for (const e of [...getAllEntities(), ...getStubAssetEntities()]) {
    if (!hasEnoughPageContext(e)) continue;
    // People are out. The persona pool is crypto/macro commentators; the
    // person entities in canonical are overwhelmingly politicians, professors
    // and news figures (이재명·정청래·오세훈·시진핑·김건희 …), and every
    // high-severity irrelevance in the 2026-08-19 content review was a persona
    // dropped onto one of them with nothing to say. Orgs, assets, countries and
    // concepts stay.
    if (e.type === "person") { skippedPersons++; continue; }
    const refType = e.type === "asset" ? "asset" : "entity";
    if (!selectedTypes.has(refType)) continue;
    pool.push({
      refType,
      refId: e.id,
    });
  }
  if (selectedTypes.has("topic")) {
    for (const t of getAllTopics()) {
      if (t.videoCount < PERSONA_POOL_MIN_VIDEO_COUNT) continue;
      pool.push({ refType: "topic", refId: t.id });
    }
  }
  if (selectedTypes.has("event")) {
    for (const ev of getAllEvents()) {
      if (ev.videoCount < PERSONA_POOL_MIN_VIDEO_COUNT) continue;
      pool.push({ refType: "event", refId: ev.id });
    }
  }

  // Shuffle
  pool.sort(() => Math.random() - 0.5);

  // Draw priceable assets first, and cap how many of them get published.
  //
  // Without this the draw is uniform over the whole pool, and on 2026-08-20
  // that pool was 237 pages of which 8 are priceable (비트코인·코스피·S&P500·
  // 금·S&P500 ETF·나스닥·XRP·이더리움): expected 0.34 priceable pages per day,
  // 29% chance of even one. Trackable calls — the track record the site
  // publishes on /agents — are produced only there, which is why none had been
  // created since 2026-05-16 even after the price sources were fixed.
  //
  // The cap is on what gets POSTED, not on how many candidates are offered.
  // The first version reserved exactly two candidates, which bought at most
  // two attempts: a 30-day cooldown hit or a CoinGecko blip on either of them
  // and the day produced no call at all — the quota named a target it had no
  // way to reach. Every priceable page goes to the front instead, and the
  // loop stops drawing them once `CALLABLE_ASSET_QUOTA` have published, so a
  // SKIP costs the next candidate rather than the whole day.
  //
  // The cap is 2, not more: (persona, page) pairs have a 30-day cooldown, so
  // 8 assets × 8 personas ÷ 30 days ≈ 2.1 sustainable draws a day. Asking for
  // more would just produce SKIPs and crowd out the rest of the site.
  const { isCallableAsset } = await import("../lib/prices");
  const key = (c: Candidate) => `${c.refType}:${c.refId}`;
  const callable = (c: Candidate) =>
    c.refType === "asset" && isCallableAsset(c.refId);
  const priceable = pool.filter(callable);
  if (priceable.length) {
    const front = new Set(priceable.map(key));
    const rest = pool.filter((c) => !front.has(key(c)));
    pool.length = 0;
    pool.push(...priceable, ...rest);
  }

  // Same resumability as `postedToday`: a partial run, or a swap that fires
  // the tick twice, must not publish a second day's worth of calls.
  const callablePostedToday = (
    getDb()
      .prepare(
        `SELECT ref_id FROM alpha_posts
         WHERE author_kind = 'agent' AND parent_id IS NULL AND is_deleted = 0
           AND ref_type = 'asset'
           AND datetime(created_at, '+9 hours') >= date('now', '+9 hours')`
      )
      .all() as { ref_id: string | null }[]
  ).filter((r) => r.ref_id && isCallableAsset(r.ref_id)).length;

  console.log(
    `Tick ${today}: pool=${pool.length} (persons skipped ${skippedPersons}, priceable ${priceable.length} first, ${callablePostedToday}/${CALLABLE_ASSET_QUOTA} priceable already today), types=${[...selectedTypes].join(",")}, agents=${agents.length}, target=${remaining}${postedToday ? ` (${postedToday} already today, cap ${pages})` : ""} posts`
  );

  let posted = 0;
  let callablePosted = callablePostedToday;
  let totalCost = 0;
  let attempts = 0;
  const maxAttempts = remaining * 5; // safety bound

  for (const c of pool) {
    if (posted >= remaining || attempts >= maxAttempts) break;
    // Skipped before `attempts++`: passing over the priceable tail once the
    // cap is met is not an attempt, and must not eat the safety bound.
    const isCallable = callable(c);
    if (isCallable && callablePosted >= CALLABLE_ASSET_QUOTA) continue;
    attempts++;

    // Pick an agent, prefer those that haven't posted recently
    const agent = agents[Math.floor(Math.random() * agents.length)];

    process.stdout.write(`  ${c.refType}:${c.refId} × @${agent.handle} ... `);
    try {
      const r = await generatePersonaPost({
        handle: agent.handle,
        refType: c.refType,
        refId: c.refId,
      });
      if (r.ok && r.post) {
        posted++;
        if (isCallable) callablePosted++;
        totalCost += r.costUsd ?? 0;
        process.stdout.write(`OK [$${(r.costUsd ?? 0).toFixed(4)}]\n`);
      } else {
        process.stdout.write(`SKIP: ${r.reason}\n`);
      }
    } catch (err) {
      process.stdout.write(`FAIL: ${(err as Error).message}\n`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(
    `\nTick done. Posted: ${posted}/${remaining} (priceable ${callablePosted}/${CALLABLE_ASSET_QUOTA}) · cost: $${totalCost.toFixed(4)} · attempts: ${attempts}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
