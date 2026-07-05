import { listIndexedPages } from "@/lib/db";
import { submitUrls, INDEXNOW_ENABLED } from "@/lib/indexnow";
import { SITE } from "@/lib/seo";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Manual IndexNow ping trigger.
 * GET  /api/admin/indexnow            → ping all indexable URLs
 * POST /api/admin/indexnow {urls:[]}  → ping specific URL list
 *
 * Auth: requires `Authorization: Bearer <INDEXNOW_ADMIN_TOKEN>`.
 * The env var must be set or the endpoint is disabled (fail-closed) —
 * otherwise anyone could burn the site's IndexNow quota. The weekly
 * cron (scripts/indexnow-cron.ts) calls submitUrls() directly and does
 * NOT go through this route, so gating it here is safe.
 */

/** Constant-time bearer-token check against INDEXNOW_ADMIN_TOKEN. */
function isAuthorized(req: Request): boolean {
  const expected = process.env.INDEXNOW_ADMIN_TOKEN || "";
  if (!expected) return false; // fail-closed when unconfigured
  const header = req.headers.get("authorization") || "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function unauthorized(): Response {
  const configured = !!process.env.INDEXNOW_ADMIN_TOKEN;
  return Response.json(
    {
      error: configured ? "unauthorized" : "admin_token_not_configured",
      message: configured
        ? "Valid 'Authorization: Bearer <INDEXNOW_ADMIN_TOKEN>' required."
        : "Set INDEXNOW_ADMIN_TOKEN env to enable this endpoint.",
    },
    { status: configured ? 401 : 503 }
  );
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
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
  if (!isAuthorized(req)) return unauthorized();
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
