/**
 * System freshness — single source for /health page and /api/health JSON.
 *
 * Each subsystem reports when its newest content was generated. Status is
 * derived from a threshold (warn / fail) measured against the expected
 * cadence of the subsystem.
 */

import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { rateLimitSnapshot } from "./rate-limit";
import { getHeartbeat } from "./cron-heartbeat";
import { assetCoverage, isCallableAsset } from "./prices";
import { todayAiSpendUsd } from "./grok";
import { recentAuditRuns, type AuditRun } from "./audit-log";
import { getAllEntities, getStubAssetEntities } from "./mic";
import { hasEnoughPageContext } from "./persona-post";

const KST_OFFSET_MS = 9 * 3600_000;

export type Status = "ok" | "warn" | "fail" | "info";

export type SubsystemHealth = {
  key: string;
  label: string;
  cadence: string; // human-readable expected cadence
  /** ISO timestamp of the newest record we have */
  lastAt: string | null;
  /** Optional date label of the newest content (e.g., brief date) */
  latestDate?: string | null;
  /** seconds since lastAt */
  ageSec: number | null;
  /** thresholds in seconds */
  warnAfterSec: number;
  failAfterSec: number;
  status: Status;
  note?: string;
};

function ageSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function classify(
  age: number | null,
  warn: number,
  fail: number
): Status {
  if (age == null) return "fail";
  if (age >= fail) return "fail";
  if (age >= warn) return "warn";
  return "ok";
}

function toSubsystem(args: {
  key: string;
  label: string;
  cadence: string;
  lastAt: string | null;
  latestDate?: string | null;
  warnAfterSec: number;
  failAfterSec: number;
  note?: string;
}): SubsystemHealth {
  const age = ageSeconds(args.lastAt);
  return {
    key: args.key,
    label: args.label,
    cadence: args.cadence,
    lastAt: args.lastAt,
    latestDate: args.latestDate ?? null,
    ageSec: age,
    warnAfterSec: args.warnAfterSec,
    failAfterSec: args.failAfterSec,
    status: classify(age, args.warnAfterSec, args.failAfterSec),
    note: args.note,
  };
}

function applyHeartbeatFailure(
  subsystem: SubsystemHealth,
  heartbeat: ReturnType<typeof getHeartbeat>
): SubsystemHealth {
  if (heartbeat?.lastStatus !== "error") return subsystem;
  return {
    ...subsystem,
    status: "fail",
    note: `cron 마지막 실행 실패. ${heartbeat.lastNote ?? "상세 기록 없음"}`,
  };
}

/**
 * Second opinion for heartbeat-backed subsystems.
 *
 * A heartbeat answers "did the cron run?" — it cannot answer "is this
 * subsystem still producing anything?". trackable_calls reported `ok` through
 * 95 days of zero output because its status came from the heartbeat alone,
 * while the newest call sat at 2026-05-15. So content age is applied as a
 * ceiling on top of the heartbeat verdict.
 *
 * Thresholds are deliberately generous: these crons are event-driven and a
 * genuinely quiet week produces nothing. They are there to catch a subsystem
 * that has stopped, not one that is merely idle.
 *
 * Caps out at `warn`, never `fail`. `fail` is reserved for "the cron itself is
 * broken" (applyHeartbeatFailure), which is actionable right now; "the cron
 * runs but the pipeline has nothing to produce" is a real signal but not an
 * outage — and /api/health?strict=1 turns fail into a 503 for uptime monitors.
 */
function applyContentStaleness(
  subsystem: SubsystemHealth,
  contentAt: string | null,
  thresholds: { warnAfterSec: number; failAfterSec: number }
): SubsystemHealth {
  if (subsystem.status === "fail") return subsystem;
  const age = ageSeconds(contentAt);
  const raw = classify(age, thresholds.warnAfterSec, thresholds.failAfterSec);
  if (raw === "ok") return subsystem;
  const verdict: Status = raw === "fail" ? "warn" : raw;
  if (subsystem.status === verdict) return subsystem;
  const since = contentAt
    ? `마지막 산출물 ${contentAt.slice(0, 10)} (${fmtAge(age)} 경과)`
    : "산출물 기록 없음";
  return {
    ...subsystem,
    status: verdict,
    note: `${subsystem.note ? subsystem.note + " " : ""}cron 은 돌고 있으나 ${since} — 생성이 멈췄는지 확인 필요.`,
  };
}

/** Event-driven crons may be legitimately quiet for days; a fortnight of
 *  nothing is a warning, six weeks is a stopped subsystem. */
const CONTENT_WARN_SEC = 14 * 24 * 3600;
const CONTENT_FAIL_SEC = 45 * 24 * 3600;

export type CostBudget = {
  day: string;
  /** Metered spend on user-facing paid endpoints — what the cap governs. */
  costUsd: number;
  callCount: number;
  capUsd: number;
  /** Fraction 0..1+ */
  utilization: number;
  status: Status;
  /** Today's unattended pipeline (cron) LLM spend. Not capped, but shown —
   *  it used to be invisible, so this widget read $0.00 on days the crons
   *  spent real money. Grok only; the OpenAI audit bills separately. */
  pipelineCostUsd: number;
  pipelineRunCount: number;
};

export function getCostBudget(): CostBudget {
  const snap = rateLimitSnapshot();
  const utilization = snap.cap_usd > 0 ? snap.today.costUsd / snap.cap_usd : 0;
  let status: Status = "ok";
  if (utilization >= 1.0) status = "fail";
  else if (utilization >= 0.7) status = "warn";
  const pipeline = todayAiSpendUsd();
  return {
    day: snap.today.day,
    costUsd: snap.today.costUsd,
    callCount: snap.today.callCount,
    capUsd: snap.cap_usd,
    utilization,
    status,
    pipelineCostUsd: pipeline.costUsd,
    pipelineRunCount: pipeline.runCount,
  };
}

/**
 * LLM citation audit — an outcome, not a subsystem.
 *
 * Deliberately kept out of `subsystems`: those measure "is the pipeline
 * running", and this one runs perfectly while reporting 0%. Folding a content
 * result into a liveness roll-up would either page someone weekly over
 * something no restart fixes, or get ignored — and `?strict=1` is wired to
 * uptime monitors. It is reported beside them instead.
 */
export type AuditSummary = {
  runs: AuditRun[];
  latest: AuditRun | null;
  /** Citation rate of the newest run, 0..1. null when nothing has run. */
  latestRate: number | null;
  /** Days since the newest run. The cadence is weekly, so a number well past
   *  7 means the cron stopped — without this the page shows a stale figure
   *  with no hint of its age. */
  ageDays: number | null;
  /** Last attempt as recorded by the cron itself, including runs that wrote no
   *  summary because every call errored. */
  lastRun: { at: string; status: string; note: string | null } | null;
};

function getAuditSummary(): AuditSummary {
  let runs: AuditRun[] = [];
  try {
    runs = recentAuditRuns(8);
  } catch (err) {
    // Same policy as row() above: only a missing table means "nothing has run
    // yet". Swallowing everything would turn a real DB error into the page
    // saying "아직 기록된 실행이 없습니다", which is the false-green this
    // whole section exists to remove — and scripts/check-health.ts, which only
    // fails on a throw, would pass right over it.
    if (!(err instanceof Error && /no such table/i.test(err.message))) throw err;
  }
  const latest = runs[0] ?? null;
  const hb = getHeartbeat("alpha-audit-cron");
  const ageSec = latest ? ageSeconds(`${latest.date}T00:00:00Z`) : null;
  return {
    runs,
    latest,
    // Rate is over answers, not distinct queries — one query asked twice
    // yields two chances to be cited.
    latestRate: latest && latest.answers > 0 ? latest.cited / latest.answers : null,
    ageDays: ageSec == null ? null : Math.floor(ageSec / 86400),
    lastRun: hb
      ? { at: hb.lastRunAt, status: hb.lastStatus, note: hb.lastNote }
      : null,
  };
}

export function getSystemHealth(): {
  generatedAt: string;
  worstStatus: Status;
  subsystems: SubsystemHealth[];
  costBudget: CostBudget;
  audit: AuditSummary;
} {
  const db = getDb();

  // Each subsystem's table is created lazily by its own module (e.g.
  // alpha_brief_summaries by lib/brief.ts) the first time it writes. On a
  // fresh DB — before any cron has run — those tables don't exist yet, so a
  // raw SELECT would throw "no such table" and crash the whole health page.
  // Treat a missing table as no-data (undefined → lastAt null → fail status),
  // which is the honest representation; rethrow anything else.
  const row = <T,>(sql: string): T | undefined => {
    try {
      return db.prepare(sql).get() as T | undefined;
    } catch (err) {
      if (err instanceof Error && /no such table/i.test(err.message)) {
        return undefined;
      }
      throw err;
    }
  };
  /** Same contract as row(), for the queries that need every matching row. */
  const rows = <T,>(sql: string): T[] => {
    try {
      return db.prepare(sql).all() as T[];
    } catch (err) {
      if (err instanceof Error && /no such table/i.test(err.message)) {
        return [];
      }
      throw err;
    }
  };

  // ─── DB-backed subsystems ───────────────────────────────────────
  const brief = row<{ d: string; g: string }>(
    `SELECT MAX(date) AS d, MAX(generated_at) AS g FROM alpha_brief_summaries`
  );
  const synthesis = row<{ g: string }>(
    `SELECT MAX(generated_at) AS g FROM alpha_synthesis`
  );
  const personaPosts = row<{ g: string }>(
    `SELECT MAX(created_at) AS g FROM alpha_posts WHERE author_kind = 'agent' AND parent_id IS NULL`
  );
  const personaReplies = row<{ g: string }>(
    `SELECT MAX(created_at) AS g FROM alpha_posts WHERE author_kind = 'agent' AND parent_id IS NOT NULL`
  );
  const whyMoved = row<{ d: string; g: string }>(
    `SELECT MAX(date) AS d, MAX(generated_at) AS g FROM alpha_why_moved`
  );
  const briefEn = row<{ d: string; g: string }>(
    // NOTE: this table's timestamp column is `translated_at`, not the
    // `generated_at` its siblings use. row() only swallows "no such table",
    // so getting this wrong throws out of getSystemHealth() and 500s every
    // health surface — see scripts/check-health.ts.
    `SELECT MAX(date) AS d, MAX(translated_at) AS g FROM alpha_brief_translations WHERE lang = 'en'`
  );
  const macro = row<{ d: string; f: string }>(
    `SELECT MAX(date) AS d, MAX(fetched_at) AS f FROM alpha_macro_observations`
  );
  const connections = row<{ g: string }>(
    `SELECT MAX(generated_at) AS g FROM alpha_connections`
  );
  const trackable = row<{ d: string; c: string }>(
    `SELECT MAX(reference_date) AS d, MAX(created_at) AS c FROM alpha_trackable_calls`
  );

  // ─── External: SignalMap canonical files ───────────────────────
  const micPath =
    process.env.MIC_DATA_PATH || path.join(process.cwd(), "mic-data");
  let canonicalMtime: string | null = null;
  try {
    const f = path.join(micPath, "canonical-entities.json");
    if (fs.existsSync(f)) {
      canonicalMtime = fs.statSync(f).mtime.toISOString();
    }
  } catch {
    // ignore
  }

  const ONE_HOUR = 3600;
  const ONE_DAY = 24 * ONE_HOUR;

  const subsystems: SubsystemHealth[] = [
    toSubsystem({
      key: "signalmap_canonical",
      label: "SignalMap canonical (외부 입력)",
      cadence: "매일 ~09:00 KST",
      lastAt: canonicalMtime,
      warnAfterSec: 30 * ONE_HOUR,
      failAfterSec: 3 * ONE_DAY,
      note: "signalmap.moss.land 의 별도 파이프라인. 실패 시 alpha 자체로는 복구 불가.",
    }),
    toSubsystem({
      key: "brief",
      label: "Daily brief AI 요약",
      cadence: "매일 08:30 KST cron",
      lastAt: brief?.g ?? null,
      latestDate: brief?.d,
      warnAfterSec: 28 * ONE_HOUR,
      failAfterSec: 50 * ONE_HOUR,
    }),
    (() => {
      // The English surface had no health entry at all, so a translation cron
      // that silently stopped would never have shown up anywhere.
      const hb = getHeartbeat("alpha-translate-briefs-cron");
      const sub = toSubsystem({
        key: "brief_en",
        label: "English brief 번역",
        cadence: "매일 08:40 KST cron",
        lastAt: briefEn?.g ?? null,
        latestDate: briefEn?.d,
        warnAfterSec: 28 * ONE_HOUR,
        failAfterSec: 50 * ONE_HOUR,
        note: hb ? `cron 마지막 실행 ${hb.lastStatus}.` : "heartbeat 없음 — cron 실행 여부 확인 필요.",
      });
      return applyHeartbeatFailure(sub, hb);
    })(),
    toSubsystem({
      key: "synthesis",
      label: "Entity/Topic/Event AI synthesis",
      cadence: "매일 07:00 KST cron",
      lastAt: synthesis?.g ?? null,
      warnAfterSec: 28 * ONE_HOUR,
      failAfterSec: 50 * ONE_HOUR,
    }),
    toSubsystem({
      key: "persona_posts",
      label: "AI 페르소나 발화",
      cadence: "매일 09:00 KST cron · 페르소나당 daily cap",
      lastAt: personaPosts?.g ?? null,
      warnAfterSec: 28 * ONE_HOUR,
      failAfterSec: 50 * ONE_HOUR,
    }),
    toSubsystem({
      key: "persona_replies",
      label: "AI 페르소나 답글",
      cadence: "매일 12:00 KST cron",
      lastAt: personaReplies?.g ?? null,
      warnAfterSec: 28 * ONE_HOUR,
      failAfterSec: 50 * ONE_HOUR,
    }),
    (() => {
      // Event-driven: a quiet day with no new pulses produces no new article.
      // Health is therefore based on the cron's heartbeat (last successful
      // run) — not on content freshness. Stale content age is shown as info.
      const hb = getHeartbeat("alpha-why-moved-cron");
      const sub = toSubsystem({
        key: "why_moved",
        label: "Why-moved 자동 article",
        cadence: "매일 08:45 KST cron · pulse 발생 시만",
        lastAt: hb?.lastRunAt ?? whyMoved?.g ?? null,
        latestDate: whyMoved?.d,
        warnAfterSec: 28 * ONE_HOUR,
        failAfterSec: 50 * ONE_HOUR,
        note: hb
          ? `cron 마지막 실행 ${hb.lastStatus}. latest article ${whyMoved?.d ?? "-"}.`
          : "heartbeat 없음 — cron 실행 여부 확인 필요.",
      });
      return applyContentStaleness(applyHeartbeatFailure(sub, hb), whyMoved?.g ?? null, {
        warnAfterSec: CONTENT_WARN_SEC,
        failAfterSec: CONTENT_FAIL_SEC,
      });
    })(),
    toSubsystem({
      key: "macro",
      label: "Macro 데이터 fetch (FRED + ECOS)",
      cadence: "매일 06:00 KST cron",
      lastAt: macro?.f ?? null,
      latestDate: macro?.d,
      warnAfterSec: 26 * ONE_HOUR,
      failAfterSec: 50 * ONE_HOUR,
    }),
    (() => {
      // Event-driven: only posts on a priceable asset produce calls.
      // Health based on heartbeat; latest call age shown as info.
      const hb = getHeartbeat("alpha-calls-cron");
      //
      // What this note must answer: is the call supply capped, and by what?
      //
      // It used to answer that with "call 가능 자산 3/44 · 미매핑 39", which
      // read as a backlog of 39 assets waiting to be mapped. There is no such
      // backlog. The canonical `asset` type means "not a person, org, place or
      // event", so that 39 was 호르무즈 해협, MetLife Stadium, 북극여우,
      // 모르핀, RTX 2070 Super, 천궁-II — things with no price at all. The
      // number pointed at work that does not exist while hiding the actual
      // constraint, which is where posts land: in the 30 days to 2026-08-19,
      // this same query counted 9 top-level asset posts, 0 of them on a page
      // the old coin-only map could price.
      //
      // So report the funnel instead of the map. A wide map with no posts
      // landing on it is still zero calls, and only this phrasing shows that.
      //
      // getAllEntities() parses the SignalMap canonical JSON from disk. That
      // file is rewritten by an upstream pipeline, so a read can land on a
      // half-written or truncated file — and this runs on the liveness path.
      // A diagnostic must never be able to take the health endpoint down.
      //
      // The disk read and the DB query are caught separately on purpose. A
      // single try around both would report a SQL column typo as "canonical
      // 읽기 실패" — naming the wrong cause — and would swallow the exact
      // class of bug scripts/check-health.ts exists to catch. The DB side goes
      // through rows(), which swallows only "no such table" and rethrows the
      // rest, same as every other query on this page.
      let coverageNote: string;
      try {
        const poolAssets = [...getAllEntities(), ...getStubAssetEntities()]
          .filter((e) => e.type === "asset" && hasEnoughPageContext(e))
          .map((e) => e.id);
        const cov = assetCoverage(poolAssets);
        coverageNote =
          `call 가능 자산 ${cov.callable.length}` +
          (cov.pegged.length ? ` (페그 ${cov.pegged.length} 제외)` : "");
      } catch {
        coverageNote = "call 가능 자산 산출 불가 (canonical 읽기 실패)";
      }
      const recentAssetPosts = rows<{ ref_id: string; n: number }>(
        `SELECT ref_id, COUNT(*) AS n FROM alpha_posts
         WHERE ref_type = 'asset' AND parent_id IS NULL AND is_deleted = 0
           AND ref_id IS NOT NULL
           AND created_at >= date('now', '-30 day')
         GROUP BY ref_id`
      );
      const postedTotal = recentAssetPosts.reduce((a, r) => a + r.n, 0);
      const postedCallable = recentAssetPosts
        .filter((r) => isCallableAsset(r.ref_id))
        .reduce((a, r) => a + r.n, 0);
      coverageNote +=
        ` · 최근 30일 asset 글 ${postedTotal}건 중 call 가능 페이지 ${postedCallable}건`;
      const sub = toSubsystem({
        key: "trackable_calls",
        label: "Trackable price calls",
        cadence: "매일 13:00 KST cron · 가격 출처가 있는 자산만",
        lastAt: hb?.lastRunAt ?? trackable?.c ?? null,
        latestDate: trackable?.d ?? null,
        warnAfterSec: 28 * ONE_HOUR,
        failAfterSec: 50 * ONE_HOUR,
        note: hb
          ? `cron 마지막 실행 ${hb.lastStatus}. latest call created ${trackable?.c?.slice(0, 10) ?? "-"}. ${coverageNote}.`
          : `heartbeat 없음 — cron 실행 여부 확인 필요. ${coverageNote}.`,
      });
      return applyContentStaleness(applyHeartbeatFailure(sub, hb), trackable?.c ?? null, {
        warnAfterSec: CONTENT_WARN_SEC,
        failAfterSec: CONTENT_FAIL_SEC,
      });
    })(),
    (() => {
      const hb = getHeartbeat("alpha-connections-cron");
      const sub = toSubsystem({
        key: "connections",
        label: "Entity connection 가설",
        cadence: "매일 07:30 KST cron",
        lastAt: hb?.lastRunAt ?? connections?.g ?? null,
        warnAfterSec: 28 * ONE_HOUR,
        failAfterSec: 50 * ONE_HOUR,
        note: hb
          ? `cron 마지막 실행 ${hb.lastStatus}. latest connection ${connections?.g?.slice(0, 10) ?? "-"}.`
          : "heartbeat 없음 — cron 첫 실행 대기 중.",
      });
      return applyContentStaleness(applyHeartbeatFailure(sub, hb), connections?.g ?? null, {
        warnAfterSec: CONTENT_WARN_SEC,
        failAfterSec: CONTENT_FAIL_SEC,
      });
    })(),
  ];

  // Severity order, worst first — the first status any subsystem reports wins.
  const SEVERITY: Status[] = ["fail", "warn", "ok", "info"];
  const worst: Status =
    SEVERITY.find((s) => subsystems.some((x) => x.status === s)) ?? "ok";

  const costBudget = getCostBudget();

  return {
    generatedAt: new Date().toISOString(),
    worstStatus: worst,
    subsystems,
    costBudget,
    audit: getAuditSummary(),
  };
}

/** Format an ISO timestamp as "YYYY-MM-DD HH:MM KST". */
export function fmtKst(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const k = new Date(t + KST_OFFSET_MS).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 16)} KST`;
}

/** Compact age string from seconds: "5m", "2h", "1d 3h". */
export function fmtAge(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
