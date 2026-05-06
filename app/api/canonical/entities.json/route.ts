import { getAllEntities } from "@/lib/mic";
import { CORS_GET_HEADERS, corsPreflight } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function OPTIONS() {
  return corsPreflight(CORS_GET_HEADERS);
}

export async function GET() {
  const entities = getAllEntities();
  return Response.json(
    {
      version: "v1",
      generated_at: new Date().toISOString(),
      count: entities.length,
      entities: entities.map((e) => ({
        id: e.id,
        label: e.label,
        aliases: e.aliases,
        type: e.type,
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
