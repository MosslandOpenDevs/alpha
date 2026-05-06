import { getSeoPage } from "./db";

export const SITE = {
  name: "Alpha",
  longName: "Alpha by Mossland",
  baseUrl: "https://alpha.moss.land",
  description:
    "오늘의 알파, 모든 시각으로. 크립토·매크로·국제정세를 AI로 요약하고 한 곳에서 토론하는 한국형 미디어 커뮤니티.",
  descriptionEn:
    "Alpha by Mossland — Korean-first crypto×AI media + community. AI-summarized perspectives on crypto, macro, and geopolitics with anonymous discussion.",
  publisher: {
    name: "Mossland",
    url: "https://moss.land",
    sameAs: [
      "https://x.com/TheMossland",
      "https://medium.com/mossland-blog",
      "https://github.com/mossland",
      "https://github.com/MosslandOpenDevs",
      "https://disclosure.moss.land",
    ],
  },
  defaultLocale: "ko_KR",
  brandColor: "#3D7A5D",
  accentColor: "#FF7A45",
} as const;

/**
 * Resolve robots meta for a given path from the seo_pages table.
 * Default to "index, follow" for unknown paths so the site is open
 * by default. Pages explicitly marked noindex (raw pulse, sparse
 * topic, low-quality community, login-required) get noindex.
 */
export function resolveRobotsMeta(path: string): {
  index: boolean;
  follow: boolean;
} {
  const row = getSeoPage(path);
  if (!row) return { index: true, follow: true };
  const policy = row.index_policy;
  if (policy === "noindex") return { index: false, follow: true };
  return { index: true, follow: true };
}

/** Build absolute URL from a path. */
export function abs(path: string): string {
  if (!path.startsWith("/")) path = "/" + path;
  return `${SITE.baseUrl}${path}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}
