import { getActivePulses } from "@/lib/mic";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours") ?? "72")));
  const pulses = getActivePulses(hours);
  return Response.json(
    {
      version: "v1",
      generated_at: new Date().toISOString(),
      window_hours: hours,
      count: pulses.length,
      pulses,
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    }
  );
}
