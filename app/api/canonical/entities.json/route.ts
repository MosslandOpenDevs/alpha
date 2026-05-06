/**
 * canonical entities 공개 contract.
 * Phase 0에서는 placeholder. Phase 1+에 signalmap canonical store와
 * 연결 (또는 직접 import).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    version: "v1",
    generated_at: new Date().toISOString(),
    count: 0,
    entities: [],
    note: "Phase 0 placeholder. signalmap canonical store integration in Phase 1.",
  });
}
