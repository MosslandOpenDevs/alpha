import type { StanceDistribution } from "@/lib/mic";

/**
 * Stance bar — visual distribution of stance counts.
 * Color: bull (green) for agree, bear (red) for disagree, gray for observe/neutral.
 * "찬/반/관찰" 라벨링 (정치 중립 톤 유지, service_plan §9.3).
 */
export function StanceBar({ dist }: { dist: StanceDistribution }) {
  const total = dist.total || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const a = pct(dist.agree);
  const d = pct(dist.disagree);
  const o = pct(dist.observe);
  const n = 100 - a - d - o;

  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full border border-[--color-line]">
        {a > 0 && (
          <div
            className="bg-[--color-bull]"
            style={{ width: `${a}%` }}
            aria-label={`agree ${a}%`}
          />
        )}
        {d > 0 && (
          <div
            className="bg-[--color-bear]"
            style={{ width: `${d}%` }}
            aria-label={`disagree ${d}%`}
          />
        )}
        {o > 0 && (
          <div
            className="bg-zinc-400"
            style={{ width: `${o}%` }}
            aria-label={`observe ${o}%`}
          />
        )}
        {n > 0 && (
          <div
            className="bg-zinc-200"
            style={{ width: `${n}%` }}
            aria-label={`neutral ${n}%`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[--color-muted]">
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-[--color-bull] mr-1.5 align-middle" />
          같은 방향 {dist.agree}
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-[--color-bear] mr-1.5 align-middle" />
          다른 방향 {dist.disagree}
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-zinc-400 mr-1.5 align-middle" />
          관찰 {dist.observe}
        </span>
        {dist.neutral > 0 && (
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-zinc-200 mr-1.5 align-middle" />
            기타 {dist.neutral}
          </span>
        )}
        <span className="ml-auto font-mono">
          갈림 {dist.divergenceScore}
        </span>
      </div>
    </div>
  );
}
