import { SITE } from "./seo";

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.longName,
    alternateName: SITE.name,
    url: SITE.baseUrl,
    description: SITE.description,
    inLanguage: "ko-KR",
    publisher: {
      "@type": "Organization",
      name: SITE.publisher.name,
      url: SITE.publisher.url,
      sameAs: SITE.publisher.sameAs,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE.baseUrl}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.publisher.name,
    url: SITE.publisher.url,
    sameAs: SITE.publisher.sameAs,
    logo: {
      "@type": "ImageObject",
      url: `${SITE.baseUrl}/og-default.png`,
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; href: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.href.startsWith("http") ? it.href : `${SITE.baseUrl}${it.href}`,
    })),
  };
}

/** Inline-able <script type="application/ld+json"> children. */
export function jsonLdScript(obj: unknown): string {
  // schema.org JSON-LD: escape `<` to prevent script tag injection
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}
