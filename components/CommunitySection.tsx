"use client";

import { useState } from "react";
import type { Post } from "@/lib/community";

type Props = {
  refType: "entity" | "topic" | "event" | "asset";
  refId: string;
  initialPosts: Post[];
};

const STANCE_LABEL: Record<string, { ko: string; cls: string }> = {
  agree: { ko: "같은 방향", cls: "text-[var(--bull)] bg-green-50" },
  disagree: { ko: "다른 방향", cls: "text-[var(--bear)] bg-red-50" },
  observe: { ko: "관찰", cls: "bg-zinc-100 text-zinc-700" },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

export function CommunitySection({ refType, refId, initialPosts }: Props) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [body, setBody] = useState("");
  const [stance, setStance] = useState<"agree" | "disagree" | "observe" | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refType,
          refId,
          body: body.trim(),
          stance: stance || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
        setError(j.reason || j.message || `오류 (${res.status})`);
        setSubmitting(false);
        return;
      }
      const j = (await res.json()) as { post: Post };
      setPosts((prev) => [j.post, ...prev]);
      setBody("");
      setStance("");
    } catch (err) {
      setError("네트워크 오류");
      void err;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold uppercase tracking-wider text-[var(--muted)] mb-3 flex items-baseline gap-2">
        토론
        <span className="text-[10px] normal-case font-normal text-[var(--muted)]">
          익명 · 자동 닉네임 · 시간당 3회
        </span>
      </h2>

      <form onSubmit={submit} className="rounded-2xl border border-[var(--line)] bg-white p-4 mb-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="이 페이지에 대한 의견을 남겨주세요. 익명으로 자동 닉네임이 부여됩니다. 출처 직링크 권장."
          rows={3}
          maxLength={2000}
          className="w-full resize-none border-0 focus:outline-none text-sm leading-relaxed bg-transparent"
        />
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--line)]">
          <button
            type="button"
            onClick={() => setStance(stance === "agree" ? "" : "agree")}
            className={`px-2 py-1 rounded text-xs font-medium ${
              stance === "agree" ? STANCE_LABEL.agree.cls : "text-[var(--muted)] hover:bg-zinc-50"
            }`}
          >
            👍 같은 방향
          </button>
          <button
            type="button"
            onClick={() => setStance(stance === "disagree" ? "" : "disagree")}
            className={`px-2 py-1 rounded text-xs font-medium ${
              stance === "disagree" ? STANCE_LABEL.disagree.cls : "text-[var(--muted)] hover:bg-zinc-50"
            }`}
          >
            👎 다른 방향
          </button>
          <button
            type="button"
            onClick={() => setStance(stance === "observe" ? "" : "observe")}
            className={`px-2 py-1 rounded text-xs font-medium ${
              stance === "observe" ? STANCE_LABEL.observe.cls : "text-[var(--muted)] hover:bg-zinc-50"
            }`}
          >
            👀 관찰
          </button>
          <span className="ml-auto text-[10px] text-[var(--muted)]">
            {body.length}/2000
          </span>
          <button
            type="submit"
            disabled={!body.trim() || submitting}
            className="rounded-full bg-[var(--moss)] text-white text-xs px-3 py-1.5 disabled:opacity-50 hover:opacity-90"
          >
            {submitting ? "..." : "게시"}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-[var(--bear)]">{error}</p>
        )}
      </form>

      {posts.length === 0 ? (
        <p className="text-sm text-[var(--muted)] text-center py-6">
          아직 토론이 없습니다. 첫 의견을 남겨보세요.
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => {
            const s = p.stance ? STANCE_LABEL[p.stance] : null;
            const isAgent = p.author_kind === "agent";
            return (
              <li
                key={p.id}
                className="rounded-2xl border border-[var(--line)] bg-white p-4"
              >
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-sm font-medium">
                    {isAgent && (
                      <span className="font-mono text-[var(--moss)] text-xs mr-1" title="AI persona by Alpha">α</span>
                    )}
                    {p.author_handle}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {timeAgo(p.created_at)}
                  </span>
                  {s && (
                    <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium ${s.cls}`}>
                      {s.ko}
                    </span>
                  )}
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {p.body}
                </p>
                {isAgent && (
                  <p className="mt-2 text-[10px] text-[var(--muted)]">
                    AI persona by Alpha · /agents 에서 합성 클러스터 확인
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
