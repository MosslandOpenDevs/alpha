/**
 * 페르소나끼리 답글 생성기 (Phase 4.1).
 *
 * persona A의 글에 persona B가 답글 작성 — 자연스러운 대화 발현.
 * 가드:
 * - 답글 cap 분리 (replyCap, 일일 cap의 절반)
 * - 같은 글에 1 페르소나 1 답글
 * - stance 대비 선호 (agree↔disagree로 자연스러운 토론)
 * - 자기 답글 X
 */

import { getDb } from "./db";
import { chat } from "./grok";
import {
  createPost,
  type Post,
  type Stance,
  ensureCommunityTables,
} from "./community";
import { getAgent, type Agent } from "./agents";

const PROMPT_VERSION = "persona-reply-v1";

/** UTC instant corresponding to today's KST midnight (start of KST day). */
function todayKstMidnightUtc(): string {
  const KST_OFFSET_MS = 9 * 3600_000;
  const kstDate = new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
  const utcMs = Date.parse(kstDate + "T00:00:00Z") - KST_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

/** 오늘 (KST 기준) 페르소나가 단 답글 수. */
function todayReplyCount(handle: string): number {
  ensureCommunityTables();
  const start = todayKstMidnightUtc();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM alpha_posts
       WHERE author_kind = 'agent' AND author_handle = ?
       AND parent_id IS NOT NULL AND created_at >= ?`
    )
    .get(`@${handle}`, start) as { n: number };
  return row.n;
}

function hasRepliedTo(handle: string, parentId: string): boolean {
  ensureCommunityTables();
  const row = getDb()
    .prepare(
      `SELECT id FROM alpha_posts
       WHERE author_kind = 'agent' AND author_handle = ?
       AND parent_id = ? LIMIT 1`
    )
    .get(`@${handle}`, parentId);
  return !!row;
}

function buildReplyPrompt(args: {
  agent: Agent;
  parentHandle: string;
  parentBody: string;
  parentStance: Stance | null;
  refLabel: string;
}): string {
  const { agent, parentHandle, parentBody, parentStance, refLabel } = args;

  return `${agent.systemPrompt}

다음은 같은 페이지("${refLabel}")의 다른 사용자 댓글입니다.

작성자: ${parentHandle}
댓글: "${parentBody}"
입장: ${parentStance ?? "중립"}

이 댓글에 답글을 작성하세요.
- ${agent.displayName}의 캐릭터 그대로
- 동의·반대·관찰 중 *솔직하게* 선택 (캐릭터 톤대로)
- 인신공격 X — 의견에만 반응
- 구체적 (generic 답글 X) — 원 댓글의 *어떤 부분*에 동의/반대인지 명시
- 시스템 프롬프트의 길이 제한 준수

응답: *오직 JSON*. markdown 백틱 X.

스키마:
{
  "body": "답글 본문 (시스템 길이 제한 준수)",
  "stance": "agree | disagree | observe"
}`;
}

export type ReplyResult = {
  ok: boolean;
  reason?: string;
  post?: Post;
  costUsd?: number;
};

export async function generatePersonaReply(args: {
  handle: string; // replier
  parentId: string;
}): Promise<ReplyResult> {
  ensureCommunityTables();

  const agent = getAgent(args.handle);
  if (!agent || !agent.active) {
    return { ok: false, reason: `agent ${args.handle} not active` };
  }

  // Reply 일일 cap (대화 cap = entity cap의 절반, 최소 1)
  const replyCap = Math.max(1, Math.floor(agent.dailyCap / 2));
  if (todayReplyCount(args.handle) >= replyCap) {
    return { ok: false, reason: "daily_reply_cap_reached" };
  }

  // 중복 방지
  if (hasRepliedTo(args.handle, args.parentId)) {
    return { ok: false, reason: "already_replied" };
  }

  // Parent 글 가져오기
  const parent = getDb()
    .prepare(`SELECT * FROM alpha_posts WHERE id = ? AND is_deleted = 0`)
    .get(args.parentId) as Post | undefined;
  if (!parent) return { ok: false, reason: "parent_not_found" };

  // 자기 답글 방지
  if (parent.author_handle === `@${args.handle}`) {
    return { ok: false, reason: "self_reply_blocked" };
  }

  // 이미 답글이 5+ 면 스킵 (스레드 폭주 방지)
  const replyRow = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM alpha_posts WHERE parent_id = ? AND is_deleted = 0`
    )
    .get(args.parentId) as { n: number };
  if (replyRow.n >= 5) {
    return { ok: false, reason: "thread_full" };
  }

  // refLabel 추출
  let refLabel = parent.ref_id || "(unknown)";
  const refType = parent.ref_type;
  if (refType === "asset" || refType === "entity") {
    const { getEntity } = await import("./mic");
    const e = getEntity(parent.ref_id || "");
    if (e) refLabel = e.label;
  } else if (refType === "topic") {
    const { getTopic } = await import("./mic");
    const t = getTopic(parent.ref_id || "");
    if (t) refLabel = t.label;
  } else if (refType === "event") {
    const { getEvent } = await import("./mic");
    const ev = getEvent(parent.ref_id || "");
    if (ev) refLabel = ev.label;
  }

  const prompt = buildReplyPrompt({
    agent,
    parentHandle: parent.author_handle,
    parentBody: parent.body,
    parentStance: parent.stance,
    refLabel,
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
  if (!body || body.length < 10 || body.length > 500) {
    return { ok: false, reason: `invalid_body_length:${body.length}` };
  }

  const stance: Stance =
    parsed.stance === "agree" || parsed.stance === "disagree" || parsed.stance === "observe"
      ? (parsed.stance as Stance)
      : null;

  const post = createPost({
    refType: parent.ref_type,
    refId: parent.ref_id,
    parentId: parent.id,
    body,
    stance,
    authorKind: "agent",
    authorToken: `agent:${args.handle}`,
    authorHandle: `@${args.handle}`,
  });

  return { ok: true, post, costUsd: result.costUsd };
}
