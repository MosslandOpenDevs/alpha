/**
 * Minimal CORS helpers for public read endpoints.
 *
 * Public surfaces (canonical/* + health + ask + pulse) are intended to be
 * usable from any origin so that LLM clients, dashboards, and embeddings
 * built by external developers can call directly without proxying.
 */

export const CORS_GET_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

export const CORS_POST_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

export function corsPreflight(headers: Record<string, string>) {
  return new Response(null, { status: 204, headers });
}
