import type { Metadata, Viewport } from "next";
import { Source_Serif_4 } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { SITE } from "@/lib/seo";
import { SiteHeader } from "@/components/SiteHeader";
import { jsonLdScript, websiteJsonLd, organizationJsonLd } from "@/lib/jsonld";

const serifHead = Source_Serif_4({
  variable: "--font-serif-head",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

// Self-hosted Pretendard (was a render-blocking third-party CDN stylesheet).
// next/font inlines the @font-face, preloads the exact file, and gives us
// font-display: swap — no extra DNS/TLS round-trip, no supply-chain/SRI risk.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
  weight: "45 920",
  style: "normal",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.baseUrl),
  title: {
    default: `${SITE.longName} — 오늘의 알파, 모든 시각으로`,
    template: `%s · ${SITE.name} by Mossland`,
  },
  description: SITE.description,
  applicationName: SITE.longName,
  authors: [{ name: SITE.publisher.name, url: SITE.publisher.url }],
  generator: "Next.js",
  keywords: [
    "크립토",
    "비트코인",
    "이더리움",
    "매크로",
    "AI 코인",
    "Mossland",
    "MOC",
    "한국 크립토",
    "FOMC",
    "김치 프리미엄",
  ],
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: SITE.baseUrl,
    siteName: SITE.longName,
    title: `${SITE.longName} — 오늘의 알파, 모든 시각으로`,
    description: SITE.description,
  },
  // No title/description here on purpose. Metadata merges shallowly, so a
  // root-level twitter.title is inherited by every route unchanged — and once
  // a twitter title exists Next does NOT backfill it from the page's
  // openGraph. Result: every page's X card showed the homepage title. With
  // only card/site set, twitter:title and twitter:description resolve from
  // each page's openGraph (and from the root openGraph on the home page).
  twitter: {
    card: "summary_large_image",
    site: "@TheMossland",
  },
  alternates: {
    canonical: SITE.baseUrl,
    languages: {
      ko: `${SITE.baseUrl}/`,
      en: `${SITE.baseUrl}/en`,
    },
    types: {
      "application/rss+xml": `${SITE.baseUrl}/rss.xml`,
    },
  },
  robots: { index: true, follow: true },
  // Icons/manifest are wired via file conventions: app/favicon.ico,
  // app/icon.svg, app/apple-icon.tsx, app/manifest.ts.
  other: {
    "format-detection": "telephone=no",
  },
};

export const viewport: Viewport = {
  themeColor: SITE.brandColor,
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${serifHead.variable} ${pretendard.variable} h-full antialiased`}
    >
      <head>
        {/* robots는 각 페이지의 generateMetadata에서 결정 (alpha_dev_plan §2.2) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(websiteJsonLd()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(organizationJsonLd()),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-fg font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded-lg focus:bg-[var(--moss)] focus:px-4 focus:py-2 focus:text-white focus:shadow"
        >
          본문 바로가기
        </a>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
