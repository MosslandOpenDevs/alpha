import { askAlpha } from "@/lib/ask";
import { CORS_POST_HEADERS, corsPreflight } from "@/lib/cors";

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
  try {
    const result = await askAlpha(q);
    return Response.json(result, { headers: CORS_POST_HEADERS });
  } catch (err) {
    return Response.json(
      { error: "internal", message: (err as Error).message },
      { status: 500, headers: CORS_POST_HEADERS }
    );
  }
}
