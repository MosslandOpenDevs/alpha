import { askAlpha } from "@/lib/ask";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const q = (body.question || "").trim();
  if (!q || q.length < 5) {
    return Response.json({ error: "question_too_short" }, { status: 400 });
  }
  if (q.length > 500) {
    return Response.json({ error: "question_too_long" }, { status: 400 });
  }
  try {
    const result = await askAlpha(q);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: "internal", message: (err as Error).message },
      { status: 500 }
    );
  }
}
