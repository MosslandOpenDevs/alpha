import type { Synthesis } from "@/lib/synthesis";

/**
 * AI synthesis card — Smart Brevity 5-블록을 카드 1개에.
 * Alpha의 *합성 차별점*을 시각화. AI가 만든 콘텐츠 disclosure 포함.
 */
export function SynthesisCard({
  synthesis,
  refLabel,
}: {
  synthesis: Synthesis;
  refLabel: string;
}) {
  return (
    <article className="rounded-2xl bg-zinc-900 text-zinc-100 p-6 mb-8 shadow-lg">
      <header className="flex items-baseline gap-2 mb-3 text-xs text-zinc-400">
        <span className="font-mono text-sm text-[--color-accent]">α</span>
        <span className="uppercase tracking-wider">Alpha 합성</span>
        <span className="ml-auto">
          {new Date(synthesis.generatedAt).toLocaleDateString("ko-KR")}
        </span>
      </header>

      {/* [1] 한 줄 요약 */}
      <p className="text-lg sm:text-xl font-semibold leading-snug mb-3">
        {synthesis.oneLine}
      </p>

      {/* [2] 왜 중요 */}
      {synthesis.why && (
        <p className="text-sm text-zinc-300 leading-relaxed mb-5 border-l-2 border-[--color-accent] pl-3">
          {synthesis.why}
        </p>
      )}

      {/* [3] 핵심 포인트 5개 */}
      {synthesis.points.length > 0 && (
        <ul className="space-y-1.5 mb-5 text-sm">
          {synthesis.points.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-[--color-accent] font-mono text-xs mt-0.5">
                {i + 1}.
              </span>
              <span className="text-zinc-200">{p}</span>
            </li>
          ))}
        </ul>
      )}

      {/* [4] 인용 */}
      {synthesis.quotes.length > 0 && (
        <div className="space-y-2 mb-5">
          {synthesis.quotes.slice(0, 2).map((q, i) => (
            <blockquote
              key={i}
              className="text-xs text-zinc-300 italic border-l border-zinc-600 pl-3"
            >
              “{q.text}” —{" "}
              <span className="not-italic text-zinc-400">{q.source}</span>
            </blockquote>
          ))}
        </div>
      )}

      {/* [5] disclosure */}
      <footer className="pt-3 border-t border-zinc-700 text-[10px] text-zinc-500 flex items-center gap-2">
        <span>AI 합성 by Alpha — {refLabel} 관련 영상 분석 기반</span>
        <span className="ml-auto">/agents</span>
      </footer>
    </article>
  );
}
