import { askAlpha, getCachedAnswer } from "@/lib/ask";
import { CORS_POST_HEADERS, corsPreflight } from "@/lib/cors";
import {
  checkRateLimit,
  rateLimitResponse,
  addCost,
  RL_ASK,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return corsPreflight(CORS_POST_HEADERS);
}

export async function POST(req: Request) {
  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "invalid_json" },
      { status: 400, headers: CORS_POST_HEADERS }
    );
  }
  const q = (body.question || "").trim();
  if (!q || q.length < 5) {
    return Response.json(
      { error: "question_too_short" },
      { status: 400, headers: CORS_POST_HEADERS }
    );
  }
  if (q.length > 500) {
    return Response.json(
      { error: "question_too_long" },
      { status: 400, headers: CORS_POST_HEADERS }
    );
  }

  // Cached answers are free — serve them without consuming the rate budget.
  const cached = getCachedAnswer(q);
  if (cached) {
    return Response.json(cached, { headers: CORS_POST_HEADERS });
  }

  // Fresh question — gate on rate + cost limits.
  const verdict = checkRateLimit(req, RL_ASK);
  if (!verdict.ok) {
    return rateLimitResponse(verdict, CORS_POST_HEADERS);
  }

  try {
    const result = await askAlpha(q);
    if (!result.cached) {
      addCost(result.costUsd);
    }
    return Response.json(result, { headers: CORS_POST_HEADERS });
  } catch (err) {
    // Log full detail server-side; never forward upstream provider error
    // text (e.g. Grok API bodies, "GROK_API_KEY not set") to the client.
    console.error("[/api/ask] askAlpha failed:", err);
    return Response.json(
      { error: "internal" },
      { status: 500, headers: CORS_POST_HEADERS }
    );
  }
}
