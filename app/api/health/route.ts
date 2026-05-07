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

  const base = {
    status: "ok",
    service: "alpha",
    db: row?.ok === 1 ? "ok" : "fail",
    seo_pages: seoCount.n,
    ts: new Date().toISOString(),
  };

  if (!detailed) {
    return Response.json(base, { headers: CORS_GET_HEADERS });
  }

  // ?detail=1 — 모든 subsystem freshness (lib/health.ts 단일 출처)
  const sys = getSystemHealth();
  return Response.json(
    {
      ...base,
      worst_status: sys.worstStatus,
      subsystems: sys.subsystems.map((s) => ({
        key: s.key,
        status: s.status,
        last_at: s.lastAt,
        latest_date: s.latestDate,
        age_sec: s.ageSec,
        cadence: s.cadence,
      })),
    },
    { headers: CORS_GET_HEADERS }
  );
}
