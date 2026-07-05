/**
 * IndexNow protocol — Bing / Naver(추정) / Brave / Yandex 즉시 인덱싱.
 *
 * 활성 조건: env INDEXNOW_KEY 설정.
 * Key 호스팅: /indexnow-key.txt (동적 라우트가 env 값 반환).
 *
 * 비활성 시 모든 함수가 silent no-op — 코드 흐름에 영향 없음.
 */

import { SITE } from "./seo";

export const INDEXNOW_ENABLED = !!process.env.INDEXNOW_KEY;
export const INDEXNOW_KEY = process.env.INDEXNOW_KEY || "";
export const INDEXNOW_KEY_LOCATION = `${SITE.baseUrl}/indexnow-key.txt`;

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Submit one or more URLs to IndexNow. Silent no-op if no key. */
export async function submitUrls(urls: string[]): Promise<{
  ok: boolean;
  status: number;
  count: number;
}> {
  if (!INDEXNOW_ENABLED || urls.length === 0) {
    return { ok: false, status: 0, count: 0 };
  }
  const host = new URL(SITE.baseUrl).host;
  // IndexNow rejects host-mismatched URLs, and this list can originate from
  // a caller-supplied POST body — only submit URLs that belong to our host.
  const sameHost = urls.filter((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
  if (sameHost.length === 0) {
    return { ok: false, status: 0, count: 0 };
  }
  const body = {
    host,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList: sameHost.slice(0, 10000),
  };
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return { ok: res.ok, status: res.status, count: sameHost.length };
  } catch (err) {
    void err;
    return { ok: false, status: -1, count: sameHost.length };
  }
}

/** Ping a single path (relative to baseUrl). Fire-and-forget OK. */
export async function pingPath(path: string) {
  if (!INDEXNOW_ENABLED) return;
  const url = path.startsWith("http") ? path : `${SITE.baseUrl}${path}`;
  return submitUrls([url]);
}
