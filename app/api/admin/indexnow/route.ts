import { listIndexedPages } from "@/lib/db";
import { submitUrls, INDEXNOW_ENABLED } from "@/lib/indexnow";
import { SITE } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * Manual IndexNow ping trigger.
 * GET  /api/admin/indexnow            → ping all indexable URLs
 * POST /api/admin/indexnow {urls:[]}  → ping specific URL list
 *
 * Phase 1: 운영자 수동 호출. Phase 2+에 cron으로 자동.
 */

export async function GET() {
  if (!INDEXNOW_ENABLED) {
    return Response.json(
      {
        enabled: false,
        message:
          "INDEXNOW_KEY env not set. Register at Bing Webmaster Tools, set env, restart.",
      },
      { status: 503 }
    );
  }
  const pages = listIndexedPages();
  const urls = pages.map((p) => `${SITE.baseUrl}${p.path}`);
  const result = await submitUrls(urls);
  return Response.json({ enabled: true, ...result });
}

export async function POST(req: Request) {
  if (!INDEXNOW_ENABLED) {
    return Response.json(
      { enabled: false, message: "INDEXNOW_KEY env not set." },
      { status: 503 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    urls?: string[];
  };
  const urls = body.urls || [];
  if (urls.length === 0) {
    return Response.json(
      { error: "urls array required" },
      { status: 400 }
    );
  }
  const result = await submitUrls(urls);
  return Response.json({ enabled: true, ...result });
}
