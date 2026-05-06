export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    version: "v1",
    generated_at: new Date().toISOString(),
    count: 0,
    topics: [],
    note: "Phase 0 placeholder. signalmap canonical store integration in Phase 1.",
  });
}
