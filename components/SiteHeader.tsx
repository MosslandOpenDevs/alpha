/**
 * 글로벌 헤더 — 모든 페이지 상단에 노출 가능.
 * 현재는 Home에서만 사용. 다른 페이지에 nav 적용 시 도입.
 */
export function SiteHeader() {
  return (
    <div className="border-b border-[var(--line)] bg-white">
      <div className="mx-auto w-full max-w-4xl px-6 py-3 flex items-center gap-4">
        <a href="/" className="flex items-baseline gap-2">
          <span className="font-mono text-xl text-[var(--moss)]">α</span>
          <span className="font-semibold">Alpha</span>
          <span className="text-xs text-[var(--muted)] hidden sm:inline">
            by Mossland
          </span>
        </a>
        <form
          action="/search"
          method="GET"
          className="flex-1 max-w-md ml-4"
        >
          <input
            type="search"
            name="q"
            placeholder="BTC, FOMC, 이재명, AI 코인…"
            className="w-full rounded-full border border-[var(--line)] px-4 py-1.5 text-sm focus:border-[var(--moss)] focus:outline-none"
          />
        </form>
        <nav className="flex items-center gap-3 text-xs text-[var(--muted)] ml-auto">
          <a href="/ask" className="hover:text-[var(--fg)] font-medium text-[var(--moss)]">
            Ask
          </a>
          <a href="/pulse" className="hover:text-[var(--fg)] hidden sm:inline">
            Pulse
          </a>
          <a href="/today" className="hover:text-[var(--fg)]">
            오늘
          </a>
          <a href="/creators" className="hover:text-[var(--fg)] hidden sm:inline">
            Creators
          </a>
          <a href="/agents" className="hover:text-[var(--fg)] hidden sm:inline">
            Agents
          </a>
        </nav>
      </div>
    </div>
  );
}
