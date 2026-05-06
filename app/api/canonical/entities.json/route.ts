import { getAllEntities } from "@/lib/mic";

export const dynamic = "force-dynamic";
export const revalidate = 300;

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
      },
    }
  );
}
