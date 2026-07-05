"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-6 py-20 text-center">
      <p className="font-mono text-4xl text-[var(--accent)] mb-4">오류</p>
      <h1 className="text-2xl font-semibold mb-3">문제가 발생했습니다</h1>
      <p className="text-[var(--muted)] mb-8">
        일시적인 오류일 수 있습니다. 잠시 후 다시 시도해 주세요.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-[var(--moss)] text-white px-5 py-2 text-sm hover:opacity-90"
        >
          다시 시도
        </button>
        <a
          href="/"
          className="rounded-full border border-[var(--line)] px-5 py-2 text-sm hover:border-[var(--moss)]"
        >
          홈으로
        </a>
      </div>
    </main>
  );
}
