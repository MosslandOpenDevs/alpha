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

export type CostBudget = {
  day: string;
  costUsd: number;
  callCount: number;
  capUsd: number;
  /** Fraction 0..1+ */
  utilization: number;
  status: Status;
};

export function getCostBudget(): CostBudget {
  const snap = rateLimitSnapshot();
  const utilization = snap.cap_usd > 0 ? snap.today.costUsd / snap.cap_usd : 0;
  let status: Status = "ok";
  if (utilization >= 1.0) status = "fail";
  else if (utilization >= 0.7) status = "warn";
  return {
    day: snap.today.day,
    costUsd: snap.today.costUsd,
    callCount: snap.today.callCount,
    capUsd: snap.cap_usd,
    utilization,
    status,
  };
}

export function getSystemHealth(): {
  generatedAt: string;
  worstStatus: Status;
  subsystems: SubsystemHealth[];
  costBudget: CostBudget;
} {
  const db = getDb();

  const row = <T,>(sql: string): T | undefined =>
    db.prepare(sql).get() as T | undefined;

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
          ? `cron 마지막 실행 OK (${hb.lastStatus}). latest article ${whyMoved?.d ?? "-"}.`
          : "heartbeat 없음 — cron 실행 여부 확인 필요.",
      });
      return sub;
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
      // Event-driven: only crypto-mapped persona posts produce calls.
      // Health based on heartbeat; latest call age shown as info.
      const hb = getHeartbeat("alpha-calls-cron");
      return toSubsystem({
        key: "trackable_calls",
        label: "Trackable price calls",
        cadence: "매일 13:00 KST cron · CoinGecko 매핑 자산만",
        lastAt: hb?.lastRunAt ?? trackable?.c ?? null,
        latestDate: trackable?.d ?? null,
        warnAfterSec: 28 * ONE_HOUR,
        failAfterSec: 50 * ONE_HOUR,
        note: hb
          ? `cron 마지막 실행 OK (${hb.lastStatus}). latest call created ${trackable?.c?.slice(0, 10) ?? "-"}.`
          : "heartbeat 없음 — cron 실행 여부 확인 필요.",
      });
    })(),
    toSubsystem({
      key: "connections",
      label: "Entity connection 가설",
      cadence: "수동 / synthesis 와 함께 갱신",
      lastAt: connections?.g ?? null,
      warnAfterSec: 3 * ONE_DAY,
      failAfterSec: 7 * ONE_DAY,
      note: "전용 cron 없음. synthesis 옆에 묶을지 검토 중.",
    }),
  ];

  const order = ["fail", "warn", "ok", "info"] as const;
  const worst: Status = (["fail", "warn", "ok", "info"] as Status[]).find(
    (s) => subsystems.some((x) => x.status === s)
  ) ?? "ok";
  void order;

  const costBudget = getCostBudget();

  return {
    generatedAt: new Date().toISOString(),
    worstStatus: worst,
    subsystems,
    costBudget,
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
