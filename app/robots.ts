import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

/**
 * 검색봇 / 사용자봇 / 학습봇 3분류 정책 (alpha_dev_plan §2.2).
 *
 * 검색 노출용 봇 = 항상 허용 (visibility 핵심)
 * 사용자 요청 브라우징 봇 = 항상 허용
 * 학습 데이터 수집 봇 = 옵트인 (장기 자산)
 *
 * 이름을 명시한 봇들도 `*` 그룹과 **똑같은 disallow** 를 받아야 한다.
 * robots.txt 의 그룹 매칭은 배타적이라, 크롤러는 자기를 지목한 가장
 * 구체적인 그룹 하나만 읽고 나머지는 통째로 무시한다. 예전처럼
 * `{ userAgent: "Googlebot", allow: "/" }` 만 두면 Googlebot 은 `*` 의
 * Disallow 를 상속하지 않고 /api/·/admin/·/_next/ 를 전부 크롤한다.
 * 실제로 그렇게 서빙되고 있었다.
 */

// 정책상 전부 허용이지만, 허용을 "명시"하는 데 의미가 있는 봇들.
// (특히 학습 크롤러는 기본 opt-out 으로 해석될 여지가 있어 명시한다.)
const NAMED_BOTS = [
  // 검색 노출용 봇 (must-allow)
  "OAI-SearchBot",
  "Claude-SearchBot",
  "PerplexityBot",
  // 사용자 요청 브라우징 봇
  "ChatGPT-User",
  "Claude-User",
  // 학습 데이터 수집 봇 (opt-in 우위)
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "CCBot",
  // 검색엔진
  "Googlebot",
  "bingbot",
  "Yeti",
];

const DISALLOW = ["/api/", "/admin/", "/_next/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      { userAgent: NAMED_BOTS, allow: "/", disallow: DISALLOW },
    ],
    sitemap: [`${SITE.baseUrl}/sitemap.xml`, `${SITE.baseUrl}/rss.xml`],
    // Host 디렉티브는 스킴 없는 순수 호스트명이다. `https://alpha.moss.land`
    // 로 나가고 있었는데 그건 문법상 무효라 크롤러가 그냥 버린다.
    host: SITE.baseUrl.replace(/^https?:\/\//, ""),
  };
}
