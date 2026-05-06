import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const row = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  const seoCount = db
    .prepare("SELECT COUNT(*) AS n FROM alpha_seo_pages")
    .get() as { n: number };

  return Response.json({
    status: "ok",
    service: "alpha",
    db: row?.ok === 1 ? "ok" : "fail",
    seo_pages: seoCount.n,
    ts: new Date().toISOString(),
  });
}
