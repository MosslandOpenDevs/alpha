import type { MetadataRoute } from "next";
import { listIndexedPages } from "@/lib/db";
import { SITE } from "@/lib/seo";

/**
 * sitemap.xml 동적 생성.
 *
 * 출처: alpha_seo_pages 테이블에서 index_policy='index' 인 모든 row.
 * Phase 0에서는 홈만 자동 등록되어 있어 결과는 1-2 entry. Phase 1에서
 * 카드/엔티티/토픽이 추가되면 자동 확장.
 */
export const dynamic = "force-dynamic";
export const revalidate = 300;

export default function sitemap(): MetadataRoute.Sitemap {
  const rows = listIndexedPages();

  const homePresent = rows.some((r) => r.path === "/");
  const items: MetadataRoute.Sitemap = rows.map((r) => ({
    url: `${SITE.baseUrl}${r.path}`,
    lastModified: r.lastmod,
    changeFrequency: changeFreqFor(r.page_type),
    priority: priorityFor(r.page_type),
  }));

  if (!homePresent) {
    items.unshift({
      url: SITE.baseUrl,
      lastModified: new Date().toISOString(),
      changeFrequency: "hourly",
      priority: 1.0,
    });
  }
  return items;
}

function changeFreqFor(
  type: string
): "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never" {
  switch (type) {
    case "home":
      return "hourly";
    case "asset":
    case "topic":
    case "event":
      return "hourly";
    case "brief":
      return "daily";
    case "creator":
    case "compare":
    case "entity":
      return "daily";
    case "community":
      return "daily";
    case "agent":
      return "weekly";
    default:
      return "weekly";
  }
}

function priorityFor(type: string): number {
  switch (type) {
    case "home":
      return 1.0;
    case "asset":
    case "topic":
      return 0.9;
    case "event":
    case "brief":
      return 0.85;
    case "creator":
    case "compare":
    case "entity":
      return 0.7;
    case "community":
      return 0.5;
    default:
      return 0.5;
  }
}
