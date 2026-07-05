import type { NextConfig } from "next";

/**
 * Security response headers (defense-in-depth).
 *
 * We intentionally do NOT set script-src/style-src/default-src: Next.js
 * injects inline hydration scripts and the app loads an external stylesheet
 * (Pretendard CDN), so a strict source policy would need a nonce pipeline
 * and would break rendering without it. The CSP here is limited to
 * directives that are safe to enforce today (clickjacking, base-uri,
 * plugins, form targets). Tighten to a nonce-based script-src later.
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
