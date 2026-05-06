import { getAllEvents } from "@/lib/mic";
import { CORS_GET_HEADERS, corsPreflight } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function OPTIONS() {
  return corsPreflight(CORS_GET_HEADERS);
}

export async function GET() {
  const events = getAllEvents();
  return Response.json(
    {
      version: "v1",
      generated_at: new Date().toISOString(),
      count: events.length,
      events: events.map((e) => ({
        id: e.id,
        label: e.label,
        aliases: e.aliases,
        dateHint: e.dateHint,
        relatedEntityIds: e.relatedEntityIds,
        videoCount: e.videoCount,
        updatedAt: e.updatedAt,
      })),
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
        ...CORS_GET_HEADERS,
      },
    }
  );
}
