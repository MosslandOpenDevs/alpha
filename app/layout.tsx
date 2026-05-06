import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { SITE } from "@/lib/seo";
import { SiteHeader } from "@/components/SiteHeader";
import { jsonLdScript, websiteJsonLd, organizationJsonLd } from "@/lib/jsonld";

const serifHead = Source_Serif_4({
  variable: "--font-serif-head",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
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
  twitter: {
    card: "summary_large_image",
    title: `${SITE.longName} — 오늘의 알파, 모든 시각으로`,
    description: SITE.description,
    site: "@TheMossland",
  },
  alternates: {
    canonical: SITE.baseUrl,
    types: {
      "application/rss+xml": `${SITE.baseUrl}/rss.xml`,
    },
  },
  robots: { index: true, follow: true },
  icons: {
    icon: "/favicon.ico",
  },
  other: {
    "format-detection": "telephone=no",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${serifHead.variable} h-full antialiased`}>
      <head>
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
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
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
