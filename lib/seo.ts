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
 * Build a complete OpenGraph block for a page.
 *
 * Next merges metadata *shallowly*: a page that sets `openGraph` replaces the
 * root layout's object outright rather than merging into it. So the twelve
 * pages that set `openGraph: { title, description, type }` were silently
 * dropping og:image, og:url, og:site_name and og:locale — asset, brief,
 * entity, topic and event pages all shared with no card image at all — while
 * the pages that set nothing inherited the layout's generic title and the
 * bare site URL. Both halves are wrong in opposite directions.
 *
 * Passing every page through this helper keeps the site-level fields and
 * makes the per-page ones actually per-page.
 */
export function pageOpenGraph(args: {
  title: string;
  description: string;
  /** Site-relative path, e.g. `/asset/bitcoin`. */
  path: string;
  type?: "website" | "article" | "profile";
  locale?: "ko_KR" | "en_US";
}): {
  type: "website" | "article" | "profile";
  locale: string;
  url: string;
  siteName: string;
  title: string;
  description: string;
  images: Array<{ url: string; width: number; height: number; alt: string }>;
} {
  return {
    type: args.type ?? "article",
    locale: args.locale ?? SITE.defaultLocale,
    url: `${SITE.baseUrl}${args.path}`,
    siteName: SITE.longName,
    title: args.title,
    description: args.description,
    // `images` must be stated explicitly. The app/opengraph-image.tsx file
    // convention only fills in og:image when a segment leaves `openGraph`
    // unset; the moment a page provides its own object the generated image is
    // replaced along with everything else. Omitting this dropped og:image
    // from every page routed through here.
    images: [
      {
        url: `${SITE.baseUrl}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: `${SITE.longName} — ${args.title}`,
      },
    ],
  };
}

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
