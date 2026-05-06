import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

/**
 * 검색봇 / 사용자봇 / 학습봇 3분류 정책 (alpha_dev_plan §2.2).
 *
 * 검색 노출용 봇 = 항상 허용 (visibility 핵심)
 * 사용자 요청 브라우징 봇 = 항상 허용
 * 학습 데이터 수집 봇 = 옵트인 (장기 자산)
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // 일반 봇 + 검색엔진 (Googlebot/bingbot/Yeti 등 포함)
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin/", "/_next/"],
      },

      // === 검색 노출용 봇 (must-allow) ===
      { userAgent: "OAI-SearchBot", allow: "/" },
      { userAgent: "Claude-SearchBot", allow: "/" },
      { userAgent: "PerplexityBot", allow: "/" },

      // === 사용자 요청 브라우징 봇 ===
      { userAgent: "ChatGPT-User", allow: "/" },
      { userAgent: "Claude-User", allow: "/" },

      // === 학습 데이터 수집 봇 (opt-in 우위) ===
      { userAgent: "GPTBot", allow: "/" },
      { userAgent: "ClaudeBot", allow: "/" },
      { userAgent: "Google-Extended", allow: "/" },
      { userAgent: "CCBot", allow: "/" },

      // === 검색엔진 ===
      { userAgent: "Googlebot", allow: "/" },
      { userAgent: "bingbot", allow: "/" },
      { userAgent: "Yeti", allow: "/" },
    ],
    sitemap: [
      `${SITE.baseUrl}/sitemap.xml`,
      `${SITE.baseUrl}/rss.xml`,
    ],
    host: SITE.baseUrl,
  };
}
