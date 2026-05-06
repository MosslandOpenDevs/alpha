import {
  getCoMentionedEntities,
  getCoMentionedTopics,
  getCoMentionedEvents,
} from "@/lib/mic";

const TYPE_HREF: Record<string, (id: string) => string> = {
  asset: (id) => `/asset/${id}`,
  person: (id) => `/entity/${encodeURIComponent(id)}`,
  org: (id) => `/entity/${encodeURIComponent(id)}`,
  country: (id) => `/entity/${encodeURIComponent(id)}`,
  concept: (id) => `/entity/${encodeURIComponent(id)}`,
};

/**
 * 함께 언급된 entity/topic/event chip 그룹.
 * 페이지 안 internal link density 강화 (Loop 1 SEO).
 */
export function CoMentionedChips({ focalEntityId }: { focalEntityId: string }) {
  const entities = getCoMentionedEntities(focalEntityId, 12);
  const topics = getCoMentionedTopics(focalEntityId, 6);
  const events = getCoMentionedEvents(focalEntityId, 6);

  if (
    entities.length === 0 &&
    topics.length === 0 &&
    events.length === 0
  ) {
    return null;
  }

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
        함께 언급되는 것들
      </h2>

      {entities.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-[var(--muted)] mb-1.5">엔티티</div>
          <div className="flex flex-wrap gap-1.5">
            {entities.map(({ entity, count }) => {
              const href =
                (TYPE_HREF[entity.type] || TYPE_HREF.concept)(entity.id);
              return (
                <a
                  key={entity.id}
                  href={href}
                  className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-xs hover:border-[var(--moss)]"
                >
                  {entity.label}
                  <span className="ml-1.5 text-[10px] text-[var(--muted)]">
                    {count}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {topics.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-[var(--muted)] mb-1.5">토픽</div>
          <div className="flex flex-wrap gap-1.5">
            {topics.map(({ topic, count }) => (
              <a
                key={topic.id}
                href={`/topic/${encodeURIComponent(topic.id)}`}
                className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-xs hover:border-[var(--moss)]"
              >
                {topic.label}
                <span className="ml-1.5 text-[10px] text-[var(--muted)]">
                  {count}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div>
          <div className="text-xs text-[var(--muted)] mb-1.5">이벤트</div>
          <div className="flex flex-wrap gap-1.5">
            {events.map(({ event, count }) => (
              <a
                key={event.id}
                href={`/event/${encodeURIComponent(event.id)}`}
                className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-xs hover:border-[var(--moss)]"
              >
                {event.label}
                <span className="ml-1.5 text-[10px] text-[var(--muted)]">
                  {count}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
