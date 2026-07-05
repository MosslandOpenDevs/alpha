import {
  createPost,
  validateBody,
  validateParent,
  checkRateLimit,
  hashIp,
  ensureCommunityTables,
  type Stance,
  type Post,
} from "@/lib/community";
import { clientIp } from "@/lib/rate-limit";
import crypto from "node:crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "alpha_anon";

async function getOrCreateAnonToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME);
  if (existing?.value) return existing.value;
  const token = crypto.randomBytes(16).toString("hex");
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1년
    path: "/",
  });
  return token;
}

export async function POST(req: Request) {
  ensureCommunityTables();
  // Shared, trusted-proxy-aware IP derivation (not the spoofable leftmost XFF).
  const ip = clientIp(req);
  const ipHash = hashIp(ip);

  if (!checkRateLimit(ipHash, 3)) {
    return Response.json(
      { error: "rate_limit", message: "시간당 3회 작성 제한입니다." },
      { status: 429 }
    );
  }

  let body: {
    refType?: string;
    refId?: string;
    parentId?: string;
    body?: string;
    stance?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const refType = body.refType as Post["ref_type"];
  const refId = body.refId ?? null;
  if (!["entity", "topic", "event", "asset", "global"].includes(refType)) {
    return Response.json({ error: "invalid_ref_type" }, { status: 400 });
  }
  if (refType !== "global" && !refId) {
    return Response.json({ error: "missing_ref_id" }, { status: 400 });
  }

  const text = (body.body ?? "").trim();
  const validation = validateBody(text);
  if (!validation.ok) {
    return Response.json(
      { error: "invalid_body", reason: validation.reason },
      { status: 400 }
    );
  }

  const stance: Stance =
    body.stance && ["agree", "disagree", "observe"].includes(body.stance)
      ? (body.stance as Stance)
      : null;

  // Replies must attach to an existing top-level post on the same ref —
  // otherwise a crafted parentId could inject content under an unrelated
  // page or create orphaned/invisible rows.
  const parentId = body.parentId ?? null;
  if (parentId) {
    const parentCheck = validateParent(parentId, refType, refId);
    if (!parentCheck.ok) {
      return Response.json(
        { error: "invalid_parent", reason: parentCheck.reason },
        { status: 400 }
      );
    }
  }

  const token = await getOrCreateAnonToken();

  const post = createPost({
    refType,
    refId,
    parentId,
    body: text,
    stance,
    authorKind: "anonymous",
    authorToken: token,
  });

  return Response.json({ ok: true, post }, { status: 201 });
}
