/**
 * Health watchdog — polls the live health endpoint and posts to a webhook.
 *
 * The reason this exists: everything else this repo does to make /health
 * honest is worthless if nobody reads it. The 95-day trackable-calls stall was
 * invisible not only because the check lied, but because no one was watching
 * it. Fixing the first half without the second just produces a truthful signal
 * into an empty room.
 *
 * What it alerts on:
 *   - a transition INTO trouble (worst_status=fail, db=fail, or unreachable)
 *   - a transition back OUT of it (so you know it ended)
 *   - one summary per day at SUMMARY_KST_HOUR, which doubles as proof the
 *     watchdog itself is alive — silence from a dead watchdog is otherwise
 *     indistinguishable from silence from a healthy site.
 *
 * What it deliberately does NOT page on: `warn`. Event-driven subsystems go
 * warn legitimately (a quiet day produces nothing), and a pager that cries
 * every morning gets muted, which is how you end up back where we started.
 * Warns ride along in the daily summary instead.
 *
 * Blind spot, stated plainly: this runs ON the box and probes localhost. If
 * the box or PM2 is down, this is down too and you get silence — caught only
 * by the missing daily summary. An external prober (UptimeRobot et al) against
 * https://alpha.moss.land/api/health?strict=1 covers that case and costs
 * nothing; this is not a substitute for it.
 *
 * 사용법:
 *   pnpm tsx scripts/health-alert.ts           # 한 번 확인 (pm2 cron)
 *   pnpm tsx scripts/health-alert.ts --test    # 웹훅 연결만 시험
 *   pnpm tsx scripts/health-alert.ts --summary # 요약을 지금 강제 발송
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const HEALTH_URL =
  process.env.HEALTH_ALERT_URL ||
  `http://127.0.0.1:${process.env.PORT || "6900"}/api/health?detail=1`;
const WEBHOOK = process.env.ALERT_WEBHOOK_URL || "";
/** KST hour for the daily summary. 10 = after the morning cron round settles. */
const SUMMARY_KST_HOUR = Number(process.env.HEALTH_ALERT_SUMMARY_HOUR || "10");
/** Probes per run. A deploy swaps PM2 apps, briefly refusing connections; one
 *  blip must not page. Real outages fail all of them. */
const PROBE_ATTEMPTS = 3;
const PROBE_GAP_MS = 10_000;
const PROBE_TIMEOUT_MS = 15_000;

/** State beside the persistent DB — a release-local file dies on redeploy and
 *  every deploy would then re-announce the current state. */
const STATE_FILE = process.env.HEALTH_ALERT_STATE_FILE
  ? path.resolve(process.env.HEALTH_ALERT_STATE_FILE)
  : path.join(
      process.env.DB_PATH
        ? path.dirname(path.resolve(process.env.DB_PATH))
        : path.join(process.cwd(), "data"),
      "health-alert-state.json"
    );

type Level = "ok" | "warn" | "fail" | "down";
type Subsystem = { key: string; status: string; note?: string; latest_date?: string | null };
type Probe = {
  level: Level;
  httpStatus: number | null;
  worst: string | null;
  db: string | null;
  subsystems: Subsystem[];
  error?: string;
};
type State = { level: Level; since: string; lastSummaryDate: string };

function kstNow() {
  const k = new Date(Date.now() + 9 * 3600_000);
  return { date: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}

function readState(): State {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<State>;
    if (s.level) return { level: s.level, since: s.since || "", lastSummaryDate: s.lastSummaryDate || "" };
  } catch {
    // first run, or a corrupt file — treat as unknown-but-ok so we only speak
    // up on a real transition rather than announcing at every restart
  }
  return { level: "ok", since: "", lastSummaryDate: "" };
}

function writeState(s: State) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

async function probeOnce(): Promise<Probe> {
  try {
    const res = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    // Read text first, then try JSON. When getSystemHealth() throws, Next
    // answers a plain-text 500 — res.json() on that threw, landed in the catch
    // below, and the alert said "응답 없음" with httpStatus null: the app had
    // answered, with an application error, and the message said the opposite.
    const text = await res.text();
    let body: {
      status?: string;
      db?: string;
      worst_status?: string;
      subsystems?: Subsystem[];
    } = {};
    let parsed = false;
    try {
      body = JSON.parse(text);
      parsed = true;
    } catch {
      /* non-JSON body: keep the status code and a snippet */
    }
    const worst = body.worst_status ?? null;
    const db = body.db ?? null;
    const known = parsed && (worst != null || db != null || body.status != null);
    let level: Level = "ok";
    if (!res.ok && !known) {
      // Any error status without a recognisable health body — 404 from a
      // moved route, 502 from nginx, 500 text from Next — is "down". The old
      // rule keyed on >= 500 only, so a 4xx JSON error read as healthy.
      level = "down";
    } else if (db === "fail" || worst === "fail" || body.status === "fail") {
      level = "fail";
    } else if (worst === "warn") {
      level = "warn";
    }
    return {
      level,
      httpStatus: res.status,
      worst,
      db,
      subsystems: body.subsystems ?? [],
      error: level === "down" ? `HTTP ${res.status} ${text.slice(0, 120).replace(/\s+/g, " ")}` : undefined,
    };
  } catch (err) {
    return {
      level: "down",
      httpStatus: null,
      worst: null,
      db: null,
      subsystems: [],
      error: (err as Error)?.message ?? String(err),
    };
  }
}

/** Retry only a bad verdict — a good one needs no confirmation. */
async function probe(): Promise<Probe> {
  let last = await probeOnce();
  for (let i = 1; i < PROBE_ATTEMPTS && (last.level === "down" || last.level === "fail"); i++) {
    await new Promise((r) => setTimeout(r, PROBE_GAP_MS));
    last = await probeOnce();
  }
  return last;
}

async function post(content: string) {
  if (!WEBHOOK) {
    console.log("[no ALERT_WEBHOOK_URL configured] would have sent:\n" + content);
    return;
  }
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Discord caps a message at 2000 characters.
    body: JSON.stringify({ content: content.slice(0, 1900) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function troubled(l: Level) {
  return l === "fail" || l === "down";
}

function subsystemLines(p: Probe): string {
  if (!p.subsystems.length) return "";
  const bad = p.subsystems.filter((s) => s.status !== "ok");
  if (!bad.length) return `\n전 subsystem ok (${p.subsystems.length}개)`;
  return (
    "\n" +
    bad
      .map((s) => {
        const icon = s.status === "fail" ? "🔴" : s.status === "warn" ? "🟡" : "⚪";
        const note = s.note ? ` — ${s.note.slice(0, 110)}` : "";
        return `${icon} \`${s.key}\` ${s.status}${note}`;
      })
      .join("\n")
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--test")) {
    await post(
      `✅ **alpha 알림 연결 확인** — ${new Date().toISOString()}\n` +
        `감시 대상: \`${HEALTH_URL}\`\n` +
        `상태 파일: \`${STATE_FILE}\`\n` +
        `매일 ${SUMMARY_KST_HOUR}:00 KST 요약, 그 외에는 fail/복구 시에만 알립니다.`
    );
    console.log("test alert sent");
    return;
  }

  const p = await probe();
  const prev = readState();
  const { date, hour } = kstNow();
  const nowIso = new Date().toISOString();

  // "응답 없음" only when there really was none (httpStatus null: timeout,
  // refused, DNS). An HTTP error is reported as the status it was.
  const detail =
    p.level === "down"
      ? p.httpStatus == null
        ? `\`${HEALTH_URL}\` 응답 없음${p.error ? ` — ${p.error}` : ""}`
        : `\`${HEALTH_URL}\` 오류 응답 — ${p.error ?? `HTTP ${p.httpStatus}`}`
      : `HTTP ${p.httpStatus} · worst=\`${p.worst}\` · db=\`${p.db}\`${subsystemLines(p)}`;

  let spoke = false;

  // 1. Transition into trouble.
  if (troubled(p.level) && !troubled(prev.level)) {
    await post(`🔴 **alpha 이상** (${p.level})\n${detail}\n<https://alpha.moss.land/health>`);
    spoke = true;
  }
  // 2. Transition out of it.
  else if (!troubled(p.level) && troubled(prev.level)) {
    const forMsg = prev.since ? ` (${prev.since} 부터)` : "";
    await post(`🟢 **alpha 복구** — ${prev.level} → ${p.level}${forMsg}\n${detail}`);
    spoke = true;
  }

  // 3. Daily summary. Also proves this watchdog is running: if it stops, the
  //    summary stops, and that absence is the only signal a dead prober gives.
  const wantSummary = args.includes("--summary") || (hour === SUMMARY_KST_HOUR && prev.lastSummaryDate !== date);
  if (wantSummary) {
    const icon = p.level === "ok" ? "🟢" : p.level === "warn" ? "🟡" : "🔴";
    await post(`${icon} **alpha 일일 요약** ${date} ${String(hour).padStart(2, "0")}:00 KST\n${detail}`);
    spoke = true;
  }

  writeState({
    level: p.level,
    since: p.level === prev.level && prev.since ? prev.since : nowIso,
    lastSummaryDate: wantSummary ? date : prev.lastSummaryDate,
  });

  console.log(
    `level=${p.level} prev=${prev.level} http=${p.httpStatus} worst=${p.worst} spoke=${spoke}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
