import { redirect } from "next/navigation";

/**
 * /today → 302 to /brief/[YYYY-MM-DD] (KST today).
 * canonical은 /brief/[date] 영구 URL.
 */
export const dynamic = "force-dynamic";

export default function Today() {
  // KST 자정 기준 오늘 날짜
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const date = kst.toISOString().slice(0, 10);
  redirect(`/brief/${date}`);
}
