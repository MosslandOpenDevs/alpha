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
 * Disallow 를 상속하지 않고 /api/·/admin/ 를 전부 크롤한다.
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

// `/_next/` 는 일부러 빼 둔다. 여기엔 CSS·JS 번들과 next/font 파일만 있고,
// 막으면 Googlebot·bingbot 의 렌더러가 스타일시트와 하이드레이션 번들을
// 못 읽어 모바일 사용성·인덱싱 평가가 나빠진다 (Google 가이드라인 명시).
// 예전 설정은 `*` 에만 이 규칙을 걸었고 명시 봇들은 그룹 배타성 때문에
// 우연히 영향을 안 받고 있었는데, 그걸 그대로 공유하면 실제 회귀가 된다.
const DISALLOW = ["/api/", "/admin/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      { userAgent: NAMED_BOTS, allow: "/", disallow: DISALLOW },
    ],
    sitemap: [`${SITE.baseUrl}/sitemap.xml`, `${SITE.baseUrl}/rss.xml`],
    // Host 디렉티브는 Yandex 전용이었고 2018 년에 폐기됐다 (Google·Bing·Naver
    // 는 원래 무시). 남겨두되 관례대로 스킴 없는 호스트명으로 내보낸다.
    host: SITE.baseUrl.replace(/^https?:\/\//, ""),
  };
}
