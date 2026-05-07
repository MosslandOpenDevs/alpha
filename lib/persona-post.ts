/**
 * AI 페르소나 발화 생성기.
 *
 * 입력: 페르소나 + 페이지 컨텍스트 (entity/topic/event + synthesis)
 * 출력: 댓글 본문 + stance, alpha_posts에 author_kind='agent'로 INSERT.
 *
 * 가드:
 * - 일일 발화 cap (Agent.dailyCap)
 * - 같은 페이지에 1 페르소나 1회 (중복 방지)
 * - HN-decay: 사람 5+ 댓글 시 페르소나 발화 X
 */

import { getDb } from "./db";
import { chat } from "./grok";
import { createPost, type Post, type Stance, ensureCommunityTables } from "./community";
import { getAgent, type Agent } from "./agents";
import {
  getEntity,
  getTopic,
  getEvent,
} from "./mic";
import { getSynthesis } from "./synthesis";

const PROMPT_VERSION = "persona-v1";

export type RefType = "entity" | "topic" | "event" | "asset";

/** Today's date string in KST (Asia/Seoul, UTC+9). The site's daily cadence
 *  follows KST, so the daily cap should reset at KST midnight, not UTC. */
function todayKstDate(): string {
  const KST_OFFSET_MS = 9 * 3600_000;
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant corresponding to today's KST midnight (start of KST day). */
function todayKstMidnightUtc(): string {
  // KST midnight 00:00 = UTC 15:00 the previous day.
  const kstDate = todayKstDate(); // e.g. "2026-05-07"
  const utcMs = Date.parse(kstDate + "T00:00:00Z") - 9 * 3600_000;
  return new Date(utcMs).toISOString();
}

function todayBucket(): string {
  return todayKstDate();
}

/** 오늘 (KST 기준) 페르소나가 발화한 횟수. */
function todayPostCount(handle: string): number {
  ensureCommunityTables();
  const start = todayKstMidnightUtc();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM alpha_posts
       WHERE author_kind = 'agent' AND author_handle = ? AND created_at >= ?`
    )
    .get(`@${handle}`, start) as { n: number };
  return row.n;
}

/** 페르소나가 이 페이지에 이미 발화했나. */
function hasPostedOnPage(handle: string, refType: RefType, refId: string): boolean {
  ensureCommunityTables();
  const row = getDb()
    .prepare(
      `SELECT id FROM alpha_posts
       WHERE author_kind = 'agent' AND author_handle = ?
       AND ref_type = ? AND ref_id = ? LIMIT 1`
    )
    .get(`@${handle}`, refType, refId);
  return !!row;
}

/** 사람 댓글 수 (HN decay). */
function humanCount(refType: RefType, refId: string): number {
  ensureCommunityTables();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM alpha_posts
       WHERE ref_type = ? AND ref_id = ?
       AND author_kind = 'anonymous' AND is_deleted = 0`
    )
    .get(refType, refId) as { n: number };
  return row.n;
}

function buildPrompt(args: {
  agent: Agent;
  refLabel: string;
  refType: RefType;
  pageContext: string;
  topComments: { handle: string; body: string; stance: string | null }[];
}): string {
  const { agent, refLabel, refType, pageContext, topComments } = args;

  const commentsBlock =
    topComments.length > 0
      ? "\n기존 댓글 (참고):\n" +
        topComments
          .slice(0, 3)
          .map((c) => `- (${c.handle}, ${c.stance ?? "neutral"}) ${c.body.slice(0, 120)}`)
          .join("\n")
      : "";

  return `${agent.systemPrompt}

다음 페이지에 댓글을 작성합니다.
- 페이지 종류: ${refType}
- 페이지 라벨: ${refLabel}
- 페이지 핵심: ${pageContext}${commentsBlock}

작성 규칙:
- ${agent.displayName}의 캐릭터로 (시스템 프롬프트 그대로)
- 길이는 시스템에 명시된 한도 준수
- 페이지 내용에 *구체적*으로 반응 (generic comment X)
- 기존 댓글이 있으면 그 내용에 살짝 반응 (그러나 인신공격 X)

응답: *오직 JSON*. markdown 백틱 X.

스키마:
{
  "body": "댓글 본문 (시스템 프롬프트 길이 제한 준수)",
  "stance": "agree | disagree | observe"
}`;
}

export type GenerateResult = {
  ok: boolean;
  reason?: string;
  post?: Post;
  costUsd?: number;
};

export async function generatePersonaPost(args: {
  handle: string;
  refType: RefType;
  refId: string;
  /** dry-run mode: don't insert post, return preview only */
  dryRun?: boolean;
}): Promise<GenerateResult> {
  const agent = getAgent(args.handle);
  if (!agent || !agent.active) {
    return { ok: false, reason: `agent ${args.handle} not active` };
  }

  // 일일 cap 점검
  if (todayPostCount(args.handle) >= agent.dailyCap) {
    return { ok: false, reason: "daily_cap_reached" };
  }

  // 중복 방지
  if (hasPostedOnPage(args.handle, args.refType, args.refId)) {
    return { ok: false, reason: "already_posted_on_page" };
  }

  // HN decay
  if (humanCount(args.refType, args.refId) >= 5) {
    return { ok: false, reason: "hn_decay_human_5plus" };
  }

  // 페이지 컨텍스트 수집
  let refLabel = "";
  let pageContext = "";
  let synthRef = args.refType;
  // asset → entity로 매핑 (synthesis는 entity 단위)
  if (synthRef === "asset") synthRef = "entity";

  if (args.refType === "entity" || args.refType === "asset") {
    const e = getEntity(args.refId);
    if (e) {
      refLabel = e.label;
      const synth = getSynthesis("entity", args.refId);
      pageContext = synth?.oneLine || `${e.label} 영상 ${e.videoCount}편`;
    }
  } else if (args.refType === "topic") {
    const t = getTopic(args.refId);
    if (t) {
      refLabel = t.label;
      const synth = getSynthesis("topic", args.refId);
      pageContext = synth?.oneLine || t.description || `${t.label} 영상 ${t.videoCount}편`;
    }
  } else if (args.refType === "event") {
    const ev = getEvent(args.refId);
    if (ev) {
      refLabel = ev.label;
      const synth = getSynthesis("event", args.refId);
      pageContext = synth?.oneLine || `${ev.label}`;
    }
  }

  if (!refLabel) {
    return { ok: false, reason: "ref_not_found" };
  }

  // top 사람 댓글 (있으면 참고)
  ensureCommunityTables();
  const topComments = getDb()
    .prepare(
      `SELECT author_handle AS handle, body, stance FROM alpha_posts
       WHERE ref_type = ? AND ref_id = ? AND is_deleted = 0
       AND author_kind = 'anonymous'
       ORDER BY upvotes DESC, created_at DESC LIMIT 3`
    )
    .all(args.refType, args.refId) as {
    handle: string;
    body: string;
    stance: string | null;
  }[];

  const prompt = buildPrompt({
    agent,
    refLabel,
    refType: args.refType,
    pageContext,
    topComments,
  });

  const result = await chat(
    [
      { role: "system", content: agent.systemPrompt },
      { role: "user", content: prompt },
    ],
    { promptVersion: PROMPT_VERSION, maxTokens: 250, temperature: 0.7 }
  );

  let parsed: { body: string; stance: string };
  try {
    const json = result.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: `invalid_json: ${result.content.slice(0, 100)}` };
  }

  const body = (parsed.body || "").trim();
  if (!body || body.length < 10 || body.length > 800) {
    return { ok: false, reason: `invalid_body_length:${body.length}` };
  }

  const stance: Stance =
    parsed.stance === "agree" || parsed.stance === "disagree" || parsed.stance === "observe"
      ? (parsed.stance as Stance)
      : null;

  if (args.dryRun) {
    return {
      ok: true,
      post: {
        id: "dry-run",
        ref_type: args.refType,
        ref_id: args.refId,
        parent_id: null,
        author_kind: "agent",
        author_handle: `@${args.handle}`,
        author_token: null,
        body,
        stance,
        upvotes: 0,
        reports: 0,
        created_at: new Date().toISOString(),
        is_deleted: 0,
      },
      costUsd: result.costUsd,
    };
  }

  const post = createPost({
    refType: args.refType,
    refId: args.refId,
    body,
    stance,
    authorKind: "agent",
    authorToken: `agent:${args.handle}`,
    authorHandle: `@${args.handle}`,
  });

  // 트랙레코드: asset entity stance 글이면 자동 call 레코드 생성 (실패 무시)
  if (post.ref_type === "asset" && stance && stance !== "observe") {
    try {
      const { createCallFromPost } = await import("./calls");
      await createCallFromPost(post);
    } catch {
      // call creation 실패는 post 작성과 무관하게 무시
    }
  }

  return { ok: true, post, costUsd: result.costUsd };
}
