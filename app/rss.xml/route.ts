import { listRecentPages } from "@/lib/db";
import { SITE } from "@/lib/seo";

/**
 * RSS 2.0 feed — sitemap이 전체 URL이라면 RSS는 *최근 발행* (freshness
 * 시그널). Google 공식 가이드도 sitemap + RSS 둘 다 권장.
 */
export const dynamic = "force-dynamic";
export const revalidate = 300;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const rows = listRecentPages(100);
  const lastBuild = rows[0]?.lastmod || new Date().toISOString();

  const items = rows
    .map((r) => {
      const url = `${SITE.baseUrl}${r.path}`;
      return `    <item>
      <title>${escapeXml(r.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${new Date(r.lastmod).toUTCString()}</pubDate>${
        r.meta_description
          ? `\n      <description>${escapeXml(r.meta_description)}</description>`
          : ""
      }
    </item>`;
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE.longName)}</title>
    <link>${SITE.baseUrl}</link>
    <description>${escapeXml(SITE.description)}</description>
    <language>ko-KR</language>
    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>
    <atom:link href="${SITE.baseUrl}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
