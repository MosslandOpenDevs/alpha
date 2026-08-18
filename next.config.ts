import type { NextConfig } from "next";

/**
 * Security response headers (defense-in-depth).
 *
 * `script-src`/`style-src`/`default-src` are still unset, so this CSP does
 * not mitigate XSS — it covers clickjacking, base-uri, plugins and form
 * targets only. Be clear about why, because the previous note here was not:
 * it blamed an external Pretendard CDN stylesheet that the same commit had
 * already replaced with a self-hosted `next/font/local` face.
 *
 * The real blocker is that Next injects inline hydration scripts, so a strict
 * `script-src` needs a per-request nonce, and a nonce pipeline forces every
 * route to render dynamically — this site is largely static/ISR by design.
 *
 * There is no reachable XSS sink today: React escapes by default and every
 * `dangerouslySetInnerHTML` is ld+json passed through `jsonLdScript()`, which
 * escapes `<`. But the site renders anonymous submissions and LLM output, so
 * the next markdown renderer or raw-HTML field would land with no backstop.
 * Next step is `Content-Security-Policy-Report-Only` with a full policy to
 * see what a strict one would break, before enforcing it.
 */
const CSP = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
