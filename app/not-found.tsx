import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "페이지를 찾을 수 없습니다",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-6 py-20 text-center">
      <p className="font-mono text-5xl text-[var(--moss)] mb-4">404</p>
      <h1 className="text-2xl font-semibold mb-3">페이지를 찾을 수 없습니다</h1>
      <p className="text-[var(--muted)] mb-8">
        요청하신 페이지가 없거나 이동되었을 수 있습니다.
      </p>
      <a
        href="/"
        className="inline-block rounded-full bg-[var(--moss)] text-white px-5 py-2 text-sm hover:opacity-90"
      >
        홈으로 →
      </a>
    </main>
  );
}
