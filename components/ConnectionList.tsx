import { getConnectionsForEntity } from "@/lib/connections";
import { getEntity } from "@/lib/mic";

const RELATION_LABEL: Record<string, { ko: string; cls: string }> = {
  causal: { ko: "인과", cls: "bg-amber-100 text-amber-800" },
  correlative: { ko: "상관", cls: "bg-blue-100 text-blue-800" },
  narrative: { ko: "내러티브", cls: "bg-purple-100 text-purple-800" },
  contradictory: { ko: "대립", cls: "bg-red-100 text-red-800" },
  "shared-context": { ko: "맥락 공유", cls: "bg-zinc-100 text-zinc-700" },
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "확신 ↑",
  medium: "확신 중",
  low: "확신 ↓",
};

/**
 * Connection 가설 리스트 — entity 페이지에서 "관계 가설" 섹션 표시.
 * Loop 1 internal link + LLM citation 친화 ("X와 Y는 ~ 관계로 보임").
 */
export function ConnectionList({ entityId }: { entityId: string }) {
  const conns = getConnectionsForEntity(entityId, 8);
  if (conns.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold uppercase tracking-wider text-[--color-muted] mb-3 flex items-baseline gap-2">
        관계 가설
        <span className="text-[10px] normal-case font-normal text-[--color-muted]">
          (AI 합성 — 함께 언급된 영상 근거)
        </span>
      </h2>
      <ul className="space-y-2">
        {conns.map((c) => {
          // 자기 자신 외의 다른 entity 추출
          const otherId = c.entityA === entityId ? c.entityB : c.entityA;
          const other = getEntity(otherId);
          if (!other) return null;
          const href =
            other.type === "asset"
              ? `/asset/${other.id}`
              : `/entity/${encodeURIComponent(other.id)}`;
          const rel = RELATION_LABEL[c.relationType] || RELATION_LABEL["shared-context"];
          return (
            <li
              key={`${c.entityA}-${c.entityB}`}
              className="rounded-2xl border border-[--color-line] bg-white p-4"
            >
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${rel.cls}`}>
                  {rel.ko}
                </span>
                <a
                  href={href}
                  className="text-sm font-semibold text-[--color-fg] hover:text-[--color-moss] hover:underline"
                >
                  {other.label}
                </a>
                <span className="text-[10px] text-[--color-muted] ml-auto">
                  {CONFIDENCE_LABEL[c.confidence]} · 영상 {c.coMentionCount}편 근거
                </span>
              </div>
              <p className="text-sm text-zinc-700 leading-relaxed">
                {c.hypothesis}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[10px] text-[--color-muted]">
        ↑ AI 합성 가설입니다. 단정 X — 영상 근거 기반 추정. 정확한 사실은
        영상 원본 + 출처 직링크로 확인하세요.
      </p>
    </section>
  );
}
