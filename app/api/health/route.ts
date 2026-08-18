import { getDb } from "@/lib/db";
import { CORS_GET_HEADERS, corsPreflight } from "@/lib/cors";
import { getSystemHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return corsPreflight(CORS_GET_HEADERS);
}

export async function GET(req: Request) {
  const db = getDb();
  const row = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  const seoCount = db
    .prepare("SELECT COUNT(*) AS n FROM alpha_seo_pages")
    .get() as { n: number };

  const url = new URL(req.url);
  const detailed = url.searchParams.get("detail") === "1";
  // ?strict=1 — answer 503 when a subsystem has failed, so an off-the-shelf
  // monitor (UptimeRobot, nginx, a k8s probe) can watch this URL directly.
  // Off by default: the plain endpoint stays a 200 liveness probe.
  const strict = url.searchParams.get("strict") === "1";

  const dbOk = row?.ok === 1;

  // `status` used to be the literal "ok" and was never wired to the subsystem
  // roll-up, so this endpoint answered {"status":"ok"} even with every
  // pipeline down. It now reflects the worst subsystem. `warn` still reports
  // "ok" — a degraded-but-serving app is alive, and `worst_status` carries the
  // nuance for anything that wants it.
  // The subsystem roll-up reads canonical JSON off disk and aggregates several
  // tables, so it is not free. Compute it only when the answer depends on it:
  // ?detail=1 (which reports every subsystem) or ?strict=1 (whose whole point
  // is to fail the probe when a subsystem is down). A plain liveness poll —
  // the common case, possibly every few seconds — stays a single SELECT.
  const sys = detailed || strict ? getSystemHealth() : null;
  const failing = !dbOk || sys?.worstStatus === "fail";

  const base = {
    status: failing ? "fail" : "ok",
    service: "alpha",
    db: dbOk ? "ok" : "fail",
    seo_pages: seoCount.n,
    ts: new Date().toISOString(),
    // Only meaningful when the roll-up ran; otherwise say so rather than
    // implying every subsystem was checked.
    worst_status: sys ? sys.worstStatus : "not_evaluated",
  };

  const init = {
    status: strict && failing ? 503 : 200,
    headers: CORS_GET_HEADERS,
  };

  if (!detailed || !sys) {
    return Response.json(base, init);
  }

  // ?detail=1 — 모든 subsystem freshness (lib/health.ts 단일 출처)
  return Response.json(
    {
      ...base,
      // Result, not liveness — shown beside the subsystems, never folded into
      // worst_status (see lib/health.ts). A monitor that wants the citation
      // trend can read it here instead of parsing the results directory.
      audit: {
        latest_date: sys.audit.latest?.date ?? null,
        latest_rate: sys.audit.latestRate,
        age_days: sys.audit.ageDays,
        last_run: sys.audit.lastRun,
        runs: sys.audit.runs.map((r) => ({
          date: r.date,
          answers: r.answers,
          queries: r.queries,
          cited: r.cited,
          distinct_cited: r.distinctCited,
          errors: r.errors,
        })),
      },
      subsystems: sys.subsystems.map((s) => ({
        key: s.key,
        status: s.status,
        last_at: s.lastAt,
        latest_date: s.latestDate,
        age_sec: s.ageSec,
        cadence: s.cadence,
        note: s.note,
      })),
    },
    init
  );
}
