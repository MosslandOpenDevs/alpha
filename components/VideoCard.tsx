import type { VideoRecord } from "@/lib/mic";

const STANCE_LABEL: Record<string, { ko: string; cls: string }> = {
  agree: { ko: "같은 방향", cls: "text-[--color-bull] bg-green-50" },
  disagree: { ko: "다른 방향", cls: "text-[--color-bear] bg-red-50" },
  observe: { ko: "관찰", cls: "text-zinc-700 bg-zinc-100" },
  neutral: { ko: "중립", cls: "text-zinc-700 bg-zinc-100" },
};

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}일 전`;
  const mo = Math.floor(d / 30);
  return `${mo}개월 전`;
}

export function VideoCard({
  video,
  showStance = true,
}: {
  video: VideoRecord;
  showStance?: boolean;
}) {
  const a = video.analysis;
  const m = video.meta;
  const stance = a?.stance && STANCE_LABEL[a.stance];

  return (
    <article className="rounded-2xl border border-[--color-line] bg-white p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 text-xs text-[--color-muted] mb-2">
        {m.author_name && (
          <span className="font-medium text-[--color-fg]">{m.author_name}</span>
        )}
        {m.published_at && <span>· {timeAgo(m.published_at)}</span>}
        {showStance && stance && (
          <span
            className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium ${stance.cls}`}
          >
            {stance.ko}
          </span>
        )}
      </div>

      <h3 className="text-base font-semibold leading-snug mb-2 line-clamp-2">
        <a
          href={video.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          {m.title}
        </a>
      </h3>

      {a?.summary_oneline && (
        <p className="text-sm text-zinc-700 leading-relaxed line-clamp-3 mb-3">
          {a.summary_oneline}
        </p>
      )}

      {a?.quotes && a.quotes.length > 0 && (
        <blockquote className="border-l-2 border-[--color-moss] pl-3 text-sm text-zinc-600 italic mb-3 line-clamp-2">
          “{a.quotes[0].text}”
        </blockquote>
      )}

      <div className="flex items-center gap-2 text-xs text-[--color-muted]">
        <a
          href={video.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[--color-moss] hover:underline"
        >
          원본 영상 ▸
        </a>
        {m.duration_s && (
          <span>· {Math.round(m.duration_s / 60)}분</span>
        )}
      </div>
    </article>
  );
}
