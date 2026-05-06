"use client";

import { useState } from "react";

type Citation = {
  label: string;
  url: string;
  type: string;
};

type AskResult = {
  questionHash: string;
  question: string;
  answer: string;
  citations: Citation[];
  cached: boolean;
  generatedAt: string;
};

const SAMPLE_QUESTIONS = [
  "오늘 비트코인은 왜 움직였나?",
  "한국 유튜버들은 BTC ETF에 대해 어떻게 보는가?",
  "AI 코인 narrative에 대해 의견이 갈리는 지점은?",
  "MOC는 어디에 쓰이는 토큰인가?",
  "한국은행 기준금리와 BTC는 어떻게 연결되나?",
  "Mossland의 AI 전략은?",
];

export function AskClient() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(j.message || j.error || `오류 (${res.status})`);
      } else {
        const data = (await res.json()) as AskResult;
        setResult(data);
      }
    } catch (err) {
      void err;
      setError("네트워크 오류");
    } finally {
      setLoading(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (question.trim().length >= 5) ask(question.trim());
  }

  return (
    <>
      <form onSubmit={submit} className="rounded-2xl border border-[var(--line)] bg-white p-4 mb-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: 오늘 비트코인이 왜 움직였나?  한국 유튜버들은 ETH를 어떻게 보나?"
          rows={3}
          maxLength={500}
          className="w-full resize-none border-0 focus:outline-none text-sm leading-relaxed bg-transparent"
        />
        <div className="flex items-center gap-2 pt-2 mt-2 border-t border-[var(--line)]">
          <span className="text-[10px] text-[var(--muted)]">{question.length}/500</span>
          <button
            type="submit"
            disabled={question.trim().length < 5 || loading}
            className="ml-auto rounded-full bg-[var(--moss)] text-white text-xs px-4 py-1.5 disabled:opacity-50 hover:opacity-90"
          >
            {loading ? "생각 중..." : "질문하기"}
          </button>
        </div>
      </form>

      {!result && !loading && (
        <div className="mb-6">
          <p className="text-xs text-[var(--muted)] mb-2">샘플 질문 — 클릭하면 바로 답변</p>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuestion(q);
                  ask(q);
                }}
                className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs hover:border-[var(--moss)]"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-2xl border border-[var(--bear)] bg-red-50 p-4 text-sm text-[var(--bear)]">
          {error}
        </div>
      )}

      {result && (
        <article className="mb-6 rounded-2xl bg-zinc-900 text-zinc-100 p-6 shadow-lg">
          <header className="flex items-baseline gap-2 mb-3 text-xs text-zinc-400">
            <span className="font-mono text-sm text-[var(--accent)]">α</span>
            <span className="uppercase tracking-wider">Alpha 답변</span>
            {result.cached && (
              <span className="ml-2 text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded">
                cached
              </span>
            )}
            <a
              href={`/ask/q/${result.questionHash}`}
              className="ml-auto text-[--color-accent] hover:underline"
            >
              영구 URL ↗
            </a>
          </header>
          <p className="text-base font-semibold mb-3">{result.question}</p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap mb-4">
            {result.answer}
          </p>
          {result.citations.length > 0 && (
            <div className="pt-3 border-t border-zinc-700">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-2">
                인용
              </div>
              <div className="flex flex-wrap gap-1.5">
                {result.citations.map((c, i) => (
                  <a
                    key={i}
                    href={c.url}
                    className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs hover:bg-zinc-700"
                  >
                    {c.label}{" "}
                    <span className="text-[10px] text-zinc-500">({c.type})</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </article>
      )}
    </>
  );
}
