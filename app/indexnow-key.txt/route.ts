import { INDEXNOW_KEY, INDEXNOW_ENABLED } from "@/lib/indexnow";

export const dynamic = "force-dynamic";

/**
 * IndexNow key 파일.
 * Bing 등 검색엔진이 ownership 검증 시 fetch.
 * env INDEXNOW_KEY 미설정 시 404 (검색엔진은 ownership 검증 실패 → ping 무시).
 */
export async function GET() {
  if (!INDEXNOW_ENABLED) {
    return new Response("IndexNow not configured", { status: 404 });
  }
  return new Response(INDEXNOW_KEY, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
