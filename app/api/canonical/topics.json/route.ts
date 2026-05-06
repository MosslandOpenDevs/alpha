import { getAllTopics } from "@/lib/mic";
import { CORS_GET_HEADERS, corsPreflight } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function OPTIONS() {
  return corsPreflight(CORS_GET_HEADERS);
}

export async function GET() {
  const topics = getAllTopics();
  return Response.json(
    {
      version: "v1",
      generated_at: new Date().toISOString(),
      count: topics.length,
      topics: topics.map((t) => ({
        id: t.id,
        label: t.label,
        aliases: t.aliases,
        description: t.description,
        videoCount: t.videoCount,
        updatedAt: t.updatedAt,
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
