/**
 * 커뮤니티 foundation v1 — 익명 posting + 자동 닉네임.
 *
 * Phase 4 AI 페르소나도 같은 인프라 사용 (post.author_kind = 'agent').
 *
 * v1: 익명만, OAuth는 Phase 3.2+에서.
 *
 * Spam 가드: per-IP rate limit (3/hour). 부적절 키워드 reject (간단).
 */

import crypto from "node:crypto";
import { getDb } from "./db";

// 자동 닉네임 어휘 — 블라인드 패턴 (형용사 + 동물 + #숫자4자리)
const ADJECTIVES = [
  "단호한", "조용한", "예민한", "신중한", "치밀한", "느긋한",
  "용감한", "이성적인", "엉뚱한", "현명한", "활기찬", "단정한",
  "냉정한", "긍정적인", "회의적인", "낙천적인", "비판적인",
];
const ANIMALS = [
  "올빼미", "여우", "오징어", "해달", "다람쥐", "두루미",
  "수달", "하이에나", "표범", "기러기", "햄스터", "카멜레온",
  "하마", "곰", "원숭이", "사슴", "고양이",
];

export type Stance = "agree" | "disagree" | "observe" | null;
export type AuthorKind = "anonymous" | "verified" | "agent";

export type Post = {
  id: string;
  ref_type: "entity" | "topic" | "event" | "asset" | "global";
  ref_id: string | null;
  parent_id: string | null;
  author_kind: AuthorKind;
  author_handle: string;        // 닉네임 또는 agent handle
  author_token: string | null;  // anonymous는 cookie hash
  body: string;
  stance: Stance;
  upvotes: number;
  reports: number;
  created_at: string;
  is_deleted: number;
};

let _tablesEnsured = false;

export function ensureCommunityTables() {
  // Idempotent DDL — run once per process, not on every query. getDb() keeps
  // one connection, so the tables persist after the first call.
  if (_tablesEnsured) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS alpha_posts (
      id TEXT PRIMARY KEY,
      ref_type TEXT NOT NULL,
      ref_id TEXT,
      parent_id TEXT,
      author_kind TEXT NOT NULL,
      author_handle TEXT NOT NULL,
      author_token TEXT,
      body TEXT NOT NULL,
      stance TEXT,
      upvotes INTEGER DEFAULT 0,
      reports INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_alpha_posts_ref
      ON alpha_posts(ref_type, ref_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alpha_posts_parent
      ON alpha_posts(parent_id);

    CREATE TABLE IF NOT EXISTS alpha_post_rate_limit (
      ip_hash TEXT NOT NULL,
      bucket_hour TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (ip_hash, bucket_hour)
    );
  `);
  _tablesEnsured = true;
}

/**
 * Validate a client-supplied parentId for a reply.
 * Replies are single-level and must attach to a top-level post that shares
 * the same (ref_type, ref_id). Returns the reason string on failure.
 */
export function validateParent(
  parentId: string,
  refType: Post["ref_type"],
  refId: string | null
): { ok: true } | { ok: false; reason: string } {
  ensureCommunityTables();
  const parent = getDb()
    .prepare(
      `SELECT ref_type, ref_id, parent_id, is_deleted FROM alpha_posts WHERE id = ?`
    )
    .get(parentId) as
    | {
        ref_type: string;
        ref_id: string | null;
        parent_id: string | null;
        is_deleted: number;
      }
    | undefined;
  if (!parent || parent.is_deleted) return { ok: false, reason: "부모 글 없음" };
  if (parent.parent_id !== null)
    return { ok: false, reason: "답글에는 답글 불가" };
  if (parent.ref_type !== refType || parent.ref_id !== refId)
    return { ok: false, reason: "부모 글의 대상이 다름" };
  return { ok: true };
}

export function generateNickname(seed?: string): string {
  if (seed) {
    const h = crypto.createHash("sha256").update(seed).digest();
    const adj = ADJECTIVES[h[0] % ADJECTIVES.length];
    const anim = ANIMALS[h[1] % ANIMALS.length];
    const num = ((h[2] << 8) | h[3]) % 10000;
    return `${adj} ${anim}#${num.toString().padStart(4, "0")}`;
  }
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const anim = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = Math.floor(Math.random() * 10000);
  return `${adj} ${anim}#${num.toString().padStart(4, "0")}`;
}

export function hashIp(ip: string): string {
  // Don't store raw IP. Hash with daily salt.
  const salt = new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(salt + "|" + ip).digest("hex").slice(0, 16);
}

export function checkRateLimit(ipHash: string, limit = 3): boolean {
  ensureCommunityTables();
  const bucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const row = getDb()
    .prepare(
      `SELECT count FROM alpha_post_rate_limit WHERE ip_hash = ? AND bucket_hour = ?`
    )
    .get(ipHash, bucket) as { count: number } | undefined;
  if (row && row.count >= limit) return false;
  getDb()
    .prepare(
      `INSERT INTO alpha_post_rate_limit (ip_hash, bucket_hour, count) VALUES (?, ?, 1)
       ON CONFLICT(ip_hash, bucket_hour) DO UPDATE SET count = count + 1`
    )
    .run(ipHash, bucket);
  return true;
}

const BAD_KEYWORDS = [
  // 간단한 가드, 정교한 모더레이션은 Phase 3.2
  "씨발", "개새끼", "병신", "fuck", "shit",
];

export function validateBody(body: string): { ok: true } | { ok: false; reason: string } {
  if (!body || body.trim().length === 0) return { ok: false, reason: "본문 비어있음" };
  if (body.length > 2000) return { ok: false, reason: "2000자 초과" };
  const lower = body.toLowerCase();
  for (const k of BAD_KEYWORDS) {
    if (lower.includes(k)) return { ok: false, reason: "부적절 어휘 감지" };
  }
  return { ok: true };
}

export type CreatePostArgs = {
  refType: Post["ref_type"];
  refId: string | null;
  parentId?: string | null;
  body: string;
  stance?: Stance;
  authorKind?: AuthorKind;
  authorToken: string;     // anonymous = cookie value (sha256 of session secret)
  authorHandle?: string;   // 명시되면 그대로 (agent용), 아니면 token 기반 자동 생성
};

export function createPost(args: CreatePostArgs): Post {
  ensureCommunityTables();
  const id = crypto.randomBytes(8).toString("hex");
  const handle =
    args.authorHandle || generateNickname(args.authorToken);
  const post: Post = {
    id,
    ref_type: args.refType,
    ref_id: args.refId,
    parent_id: args.parentId ?? null,
    author_kind: args.authorKind ?? "anonymous",
    author_handle: handle,
    author_token: args.authorToken,
    body: args.body,
    stance: args.stance ?? null,
    upvotes: 0,
    reports: 0,
    created_at: new Date().toISOString(),
    is_deleted: 0,
  };
  getDb()
    .prepare(
      `INSERT INTO alpha_posts (id, ref_type, ref_id, parent_id, author_kind, author_handle,
        author_token, body, stance, upvotes, reports, created_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      post.id,
      post.ref_type,
      post.ref_id,
      post.parent_id,
      post.author_kind,
      post.author_handle,
      post.author_token,
      post.body,
      post.stance,
      post.upvotes,
      post.reports,
      post.created_at,
      post.is_deleted
    );
  return post;
}

export function listPostsForRef(
  refType: Post["ref_type"],
  refId: string,
  limit = 30
): PublicPost[] {
  ensureCommunityTables();
  return getDb()
    .prepare(
      `SELECT ${PUBLIC_POST_COLUMNS} FROM alpha_posts
       WHERE ref_type = ? AND ref_id = ? AND parent_id IS NULL AND is_deleted = 0
       ORDER BY upvotes DESC, created_at DESC LIMIT ?`
    )
    .all(refType, refId, limit) as PublicPost[];
}

export function listReplies(parentId: string): PublicPost[] {
  ensureCommunityTables();
  return getDb()
    .prepare(
      `SELECT ${PUBLIC_POST_COLUMNS} FROM alpha_posts
       WHERE parent_id = ? AND is_deleted = 0
       ORDER BY created_at ASC`
    )
    .all(parentId) as PublicPost[];
}

/**
 * A post as it may be handed to a page or an API response.
 *
 * `author_token` is the anonymous session cookie hash. It never left this
 * module by design, but `SELECT *` carried it into server components, which
 * serialise their props into the public page payload — so the httpOnly cookie
 * was readable in page source, and its holder could be impersonated (the
 * nickname is derived from the token). Reads select columns explicitly now,
 * and the type makes a regression a compile error rather than a quiet leak.
 */
export type PublicPost = Omit<Post, "author_token">;

/** Columns safe to expose. Deliberately not `*`. */
const PUBLIC_POST_COLUMNS = `id, ref_type, ref_id, parent_id, author_kind,
       author_handle, body, stance, upvotes, reports, created_at, is_deleted`;

export type PostWithReplies = PublicPost & { replies: PublicPost[] };

export function listPostsWithRepliesForRef(
  refType: Post["ref_type"],
  refId: string,
  limit = 30
): PostWithReplies[] {
  const parents = listPostsForRef(refType, refId, limit);
  if (parents.length === 0) return [];

  // Fetch every reply in ONE query instead of one query per parent (N+1).
  const ids = parents.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const replies = getDb()
    .prepare(
      `SELECT ${PUBLIC_POST_COLUMNS} FROM alpha_posts
       WHERE parent_id IN (${placeholders}) AND is_deleted = 0
       ORDER BY created_at ASC`
    )
    .all(...ids) as PublicPost[];

  const byParent = new Map<string, PublicPost[]>();
  for (const r of replies) {
    if (!r.parent_id) continue;
    const arr = byParent.get(r.parent_id);
    if (arr) arr.push(r);
    else byParent.set(r.parent_id, [r]);
  }

  return parents.map((p) => ({ ...p, replies: byParent.get(p.id) ?? [] }));
}

export function listRecentPosts(limit = 30): PublicPost[] {
  ensureCommunityTables();
  return getDb()
    .prepare(
      `SELECT ${PUBLIC_POST_COLUMNS} FROM alpha_posts
       WHERE is_deleted = 0
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as PublicPost[];
}
