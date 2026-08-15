/**
 * Moss Intelligence Core (MIC) consumer.
 *
 * Read-only access to signalmap canonical store + per-video analysis.
 * Embeddings are stripped at consume time — UI never needs 1536d vectors.
 *
 * Path resolution: env `MIC_DATA_PATH` points to the directory holding
 * `canonical-entities.json`, `canonical-topics.json`, `canonical-events.json`,
 * and the per-video `yt-*.json` files emitted by the SignalMap pipeline
 * (https://signalmap.moss.land — separate repo). Default: ./mic-data
 *
 * Caching: in-process LRU on canonical data (5 min TTL). Per-video reads
 * are filesystem cached by Node's path resolution; with O(1k) videos that's
 * fine. For large scale, swap to a real cache.
 */

import fs from "node:fs";
import path from "node:path";

const MIC_DATA_PATH =
  process.env.MIC_DATA_PATH || path.join(process.cwd(), "mic-data");

// ─── types ────────────────────────────────────────────────────────────

export type EntityType = "person" | "org" | "country" | "concept" | "asset";

export type Entity = {
  id: string;
  label: string;
  aliases: string[];
  type: EntityType;
  videoCount: number;
  videoIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type Topic = {
  id: string;
  label: string;
  aliases: string[];
  description?: string;
  videoCount: number;
  videoIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type EventItem = {
  id: string;
  label: string;
  aliases: string[];
  dateHint: string | null;
  relatedEntityIds: string[];
  videoCount: number;
  videoIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type VideoSource = {
  videoId: string;
  url: string;
};

export type VideoMeta = {
  title: string;
  author_name?: string;
  thumbnail_url?: string;
  duration_s?: number;
  published_at?: string;
  view_count?: number;
  channel_id?: string;
};

export type Stance = "agree" | "disagree" | "observe" | "neutral" | string;

export type VideoAnalysis = {
  summary_oneline?: string;
  claims?: string[] | { text?: string }[];
  quotes?: { text: string; ts_seconds?: number }[];
  topic_label?: string;
  topic_description?: string;
  stance?: Stance;
  stance_reason?: string;
  language?: "ko" | "en" | "mixed" | string;
  entities?: { name: string; type?: string }[];
  events?: { name: string; date_hint?: string | null }[];
};

export type VideoRecord = {
  source: VideoSource;
  meta: VideoMeta;
  analysis?: VideoAnalysis;
  canonical_topic_id?: string | null;
  canonical_entity_ids?: string[];
  canonical_event_ids?: string[];
};

export type PulseSource = {
  url: string;
  title?: string;
  publisher?: string;
  publishedAt?: string;
  excerpt?: string;
};

export type Pulse = {
  id: string;
  asset: string;
  assetLabel?: string;
  direction: "up" | "down" | string;
  magnitudePct: number;
  windowMinutes: number;
  detectedAt: string;
  priceFrom?: number;
  priceTo?: number;
  priceUnit?: string;
  summary: string;
  confidence: "speculative" | "discussed" | "reported" | "confirmed" | string;
  sources?: PulseSource[];
  synthesisState?: "raw" | "pending" | "enriched" | "reviewed" | string;
  verifiedAt?: string | null;
  verifiedSummary?: string | null;
  accuracy?: "matched" | "drifted" | "unconfirmed" | string;
};

// ─── canonical loaders (cached) ──────────────────────────────────────

type Cache<T> = { data: T; loadedAt: number };
export type PulseLoadDiagnostics = {
  invalidFiles: string[];
  duplicateIds: string[];
};
const TTL_MS = 5 * 60 * 1000;

let _entitiesCache: Cache<Entity[]> | null = null;
let _topicsCache: Cache<Topic[]> | null = null;
let _eventsCache: Cache<EventItem[]> | null = null;
let _pulsesCache: Cache<Pulse[]> | null = null;
let _pulseDiagnosticsCache: Cache<PulseLoadDiagnostics> | null = null;

function fresh<T>(c: Cache<T> | null): boolean {
  return !!c && Date.now() - c.loadedAt < TTL_MS;
}

function readCanonical<T>(file: string, stripEmbeds = true): T[] {
  const p = path.join(MIC_DATA_PATH, file);
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const items = (raw.items as Record<string, unknown>[]) || [];
  if (stripEmbeds) {
    return items.map((it) => {
      const { embedding, centroid, ...rest } = it as {
        embedding?: unknown;
        centroid?: unknown;
        [k: string]: unknown;
      };
      void embedding;
      void centroid;
      return rest as T;
    });
  }
  return items as T[];
}

export function getAllEntities(): Entity[] {
  if (fresh(_entitiesCache)) return _entitiesCache!.data;
  const data = readCanonical<Entity>("canonical-entities.json");
  _entitiesCache = { data, loadedAt: Date.now() };
  return data;
}

export function getAllTopics(): Topic[] {
  if (fresh(_topicsCache)) return _topicsCache!.data;
  const data = readCanonical<Topic>("canonical-topics.json");
  _topicsCache = { data, loadedAt: Date.now() };
  return data;
}

export function getAllEvents(): EventItem[] {
  if (fresh(_eventsCache)) return _eventsCache!.data;
  const data = readCanonical<EventItem>("canonical-events.json");
  _eventsCache = { data, loadedAt: Date.now() };
  return data;
}

export function getEntity(id: string): Entity | null {
  return getAllEntities().find((e) => e.id === id) || null;
}

export function getTopic(id: string): Topic | null {
  return getAllTopics().find((t) => t.id === id) || null;
}

export function getEvent(id: string): EventItem | null {
  return getAllEvents().find((e) => e.id === id) || null;
}

export function getEntitiesByType(type: EntityType): Entity[] {
  return getAllEntities().filter((e) => e.type === type);
}

// ─── per-video reader ────────────────────────────────────────────────

const videoCache = new Map<string, { rec: VideoRecord; loadedAt: number }>();
const VIDEO_TTL_MS = 30 * 60 * 1000;

export function getVideo(videoId: string): VideoRecord | null {
  const cached = videoCache.get(videoId);
  if (cached && Date.now() - cached.loadedAt < VIDEO_TTL_MS) return cached.rec;

  const p = path.join(MIC_DATA_PATH, `yt-${videoId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as VideoRecord & {
      embedding?: unknown;
    };
    delete raw.embedding;
    videoCache.set(videoId, { rec: raw, loadedAt: Date.now() });
    return raw;
  } catch {
    return null;
  }
}

/** Get videos for an entity, ordered by published_at desc when available. */
export function getVideosForEntity(entityId: string, limit = 12): VideoRecord[] {
  const ent = getEntity(entityId);
  if (!ent) return [];
  const recs = ent.videoIds
    .map((id) => getVideo(id))
    .filter((v): v is VideoRecord => !!v);
  recs.sort((a, b) => {
    const ta = a.meta.published_at ? Date.parse(a.meta.published_at) : 0;
    const tb = b.meta.published_at ? Date.parse(b.meta.published_at) : 0;
    return tb - ta;
  });
  return recs.slice(0, limit);
}

export function getVideosForTopic(topicId: string, limit = 12): VideoRecord[] {
  const t = getTopic(topicId);
  if (!t) return [];
  const recs = t.videoIds
    .map((id) => getVideo(id))
    .filter((v): v is VideoRecord => !!v);
  recs.sort((a, b) => {
    const ta = a.meta.published_at ? Date.parse(a.meta.published_at) : 0;
    const tb = b.meta.published_at ? Date.parse(b.meta.published_at) : 0;
    return tb - ta;
  });
  return recs.slice(0, limit);
}

export function getVideosForEvent(eventId: string, limit = 12): VideoRecord[] {
  const e = getEvent(eventId);
  if (!e) return [];
  const recs = e.videoIds
    .map((id) => getVideo(id))
    .filter((v): v is VideoRecord => !!v);
  recs.sort((a, b) => {
    const ta = a.meta.published_at ? Date.parse(a.meta.published_at) : 0;
    const tb = b.meta.published_at ? Date.parse(b.meta.published_at) : 0;
    return tb - ta;
  });
  return recs.slice(0, limit);
}

// ─── stance distribution ─────────────────────────────────────────────

export type StanceDistribution = {
  agree: number;
  disagree: number;
  observe: number;
  neutral: number;
  total: number;
  /** 0-100, higher = more divergent (closer to 50/50 split). */
  divergenceScore: number;
};

export function stanceDistribution(videos: VideoRecord[]): StanceDistribution {
  const dist = { agree: 0, disagree: 0, observe: 0, neutral: 0, total: 0 };
  for (const v of videos) {
    const s = v.analysis?.stance;
    if (s === "agree") dist.agree++;
    else if (s === "disagree") dist.disagree++;
    else if (s === "observe") dist.observe++;
    else dist.neutral++;
    dist.total++;
  }
  // divergence score: if agree+disagree are balanced and high vs total, it's
  // divergent. Normalize to 0-100. Pure consensus → 0, perfect 50/50 → 100.
  const agreePct = dist.total ? dist.agree / dist.total : 0;
  const disagreePct = dist.total ? dist.disagree / dist.total : 0;
  const opposed = Math.min(agreePct, disagreePct);
  const opposedTotal = agreePct + disagreePct;
  const divergenceScore = opposedTotal === 0
    ? 0
    : Math.round((opposed / Math.max(opposedTotal, 0.0001)) * 200);
  return { ...dist, divergenceScore: Math.min(100, divergenceScore) };
}

// ─── pulses ──────────────────────────────────────────────────────────

export function getAllPulses(): Pulse[] {
  if (fresh(_pulsesCache)) return _pulsesCache!.data;
  const dir = path.join(MIC_DATA_PATH, "pulses");
  if (!fs.existsSync(dir)) {
    const loadedAt = Date.now();
    _pulsesCache = { data: [], loadedAt };
    _pulseDiagnosticsCache = {
      data: { invalidFiles: [], duplicateIds: [] },
      loadedAt,
    };
    return [];
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith(".") && f.endsWith(".json"));
  const pulses: Pulse[] = [];
  const invalidFiles: string[] = [];
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (
        !raw ||
        typeof raw.id !== "string" ||
        !raw.id.trim() ||
        typeof raw.asset !== "string" ||
        !raw.asset.trim() ||
        typeof raw.detectedAt !== "string" ||
        !Number.isFinite(Date.parse(raw.detectedAt)) ||
        typeof raw.direction !== "string" ||
        !raw.direction.trim() ||
        typeof raw.magnitudePct !== "number" ||
        !Number.isFinite(raw.magnitudePct) ||
        typeof raw.summary !== "string" ||
        !raw.summary.trim() ||
        (raw.priceFrom != null &&
          (typeof raw.priceFrom !== "number" ||
            !Number.isFinite(raw.priceFrom))) ||
        (raw.priceTo != null &&
          (typeof raw.priceTo !== "number" || !Number.isFinite(raw.priceTo))) ||
        (raw.sources != null &&
          (!Array.isArray(raw.sources) ||
            !raw.sources.every(
              (source: unknown) =>
                !!source &&
                typeof source === "object" &&
                typeof (source as { url?: unknown }).url === "string" &&
                !!(source as { url: string }).url.trim()
            )))
      ) {
        invalidFiles.push(f);
        continue;
      }
      if (seenIds.has(raw.id)) {
        duplicateIds.add(raw.id);
        continue;
      }
      seenIds.add(raw.id);
      pulses.push(raw as Pulse);
    } catch {
      invalidFiles.push(f);
    }
  }
  pulses.sort(
    (a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt)
  );
  const loadedAt = Date.now();
  _pulsesCache = { data: pulses, loadedAt };
  _pulseDiagnosticsCache = {
    data: { invalidFiles, duplicateIds: [...duplicateIds].sort() },
    loadedAt,
  };
  return pulses;
}

export function getPulseLoadDiagnostics(): PulseLoadDiagnostics {
  getAllPulses();
  const diagnostics = _pulseDiagnosticsCache?.data ?? {
    invalidFiles: [],
    duplicateIds: [],
  };
  return {
    invalidFiles: [...diagnostics.invalidFiles],
    duplicateIds: [...diagnostics.duplicateIds],
  };
}

export function getPulse(id: string): Pulse | null {
  return getAllPulses().find((p) => p.id === id) || null;
}

/** Active = detected within last N hours and synthesisState is enriched/reviewed. */
export function getActivePulses(withinHours = 24): Pulse[] {
  const cutoff = Date.now() - withinHours * 3600_000;
  return getAllPulses().filter((p) => Date.parse(p.detectedAt) >= cutoff);
}

// ─── helpers for asset symbol mapping ────────────────────────────────

// Asset entities — slug → entity id mapping.
// Convention: /asset/btc → entity id "bitcoin"; /asset/eth → "ethereum".
const ASSET_SLUG_MAP: Record<string, string> = {
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ethereum: "ethereum",
  sol: "solana",
  solana: "solana",
  moc: "mossland",
  mossland: "mossland",
  doge: "dogecoin",
  dogecoin: "dogecoin",
  xrp: "xrp",
  ada: "cardano",
  cardano: "cardano",
};

/**
 * Known asset stubs — display these even if signalmap canonical doesn't have
 * them yet. Provides stable URLs (영구 URL 약속, alpha_dev_plan §2.4).
 * `videoCount: 0` triggers noindex via quality_score gating.
 */
const ASSET_STUBS: Record<string, Pick<Entity, "id" | "label" | "aliases" | "type">> = {
  ethereum: {
    id: "ethereum",
    label: "이더리움",
    aliases: ["Ethereum", "ETH"],
    type: "asset",
  },
  mossland: {
    id: "mossland",
    label: "Mossland (MOC)",
    aliases: ["MOC", "Moss Coin", "모스랜드", "모스코인"],
    type: "asset",
  },
  solana: {
    id: "solana",
    label: "솔라나",
    aliases: ["Solana", "SOL"],
    type: "asset",
  },
  dogecoin: {
    id: "dogecoin",
    label: "도지코인",
    aliases: ["Dogecoin", "DOGE"],
    type: "asset",
  },
  xrp: {
    id: "xrp",
    label: "XRP (리플)",
    aliases: ["Ripple", "리플"],
    type: "asset",
  },
  cardano: {
    id: "cardano",
    label: "카르다노",
    aliases: ["Cardano", "ADA"],
    type: "asset",
  },
};

export function entityIdFromAssetSlug(slug: string): string {
  const lower = slug.toLowerCase();
  return ASSET_SLUG_MAP[lower] || lower;
}

export function assetSlugFromEntity(entity: Entity): string {
  const lower = entity.id.toLowerCase();
  for (const [slug, id] of Object.entries(ASSET_SLUG_MAP)) {
    if (id === lower && slug.length <= 4) return slug;
  }
  return lower;
}

/**
 * Resolve asset entity, falling back to stub if signalmap canonical
 * doesn't have it yet. Stubs have videoCount=0 → noindex.
 */
export function getAssetOrStub(slug: string): Entity | null {
  const id = entityIdFromAssetSlug(slug);
  const real = getEntity(id);
  if (real && real.type === "asset") return real;

  const stub = ASSET_STUBS[id];
  if (stub) {
    const now = new Date().toISOString();
    return {
      ...stub,
      videoCount: 0,
      videoIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }
  return null;
}

export function getAssetEntities(): Entity[] {
  return getEntitiesByType("asset");
}

// ─── co-mention helpers ──────────────────────────────────────────────

/** Top N entities co-mentioned with the focal entity (excludes self). */
export function getCoMentionedEntities(
  focalEntityId: string,
  limit = 12
): { entity: Entity; count: number }[] {
  const ent = getEntity(focalEntityId);
  if (!ent) return [];
  const counts = new Map<string, number>();
  for (const vid of ent.videoIds) {
    const v = getVideo(vid);
    if (!v) continue;
    for (const eid of v.canonical_entity_ids || []) {
      if (eid === focalEntityId) continue;
      counts.set(eid, (counts.get(eid) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ entity: getEntity(id), count }))
    .filter((x): x is { entity: Entity; count: number } => !!x.entity)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Top N topics co-mentioned with focal entity. */
export function getCoMentionedTopics(
  focalEntityId: string,
  limit = 6
): { topic: Topic; count: number }[] {
  const ent = getEntity(focalEntityId);
  if (!ent) return [];
  const counts = new Map<string, number>();
  for (const vid of ent.videoIds) {
    const v = getVideo(vid);
    if (!v?.canonical_topic_id) continue;
    counts.set(
      v.canonical_topic_id,
      (counts.get(v.canonical_topic_id) || 0) + 1
    );
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ topic: getTopic(id), count }))
    .filter((x): x is { topic: Topic; count: number } => !!x.topic)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Top N events co-mentioned with focal entity. */
export function getCoMentionedEvents(
  focalEntityId: string,
  limit = 6
): { event: EventItem; count: number }[] {
  const ent = getEntity(focalEntityId);
  if (!ent) return [];
  const counts = new Map<string, number>();
  for (const vid of ent.videoIds) {
    const v = getVideo(vid);
    if (!v) continue;
    for (const eid of v.canonical_event_ids || []) {
      counts.set(eid, (counts.get(eid) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ event: getEvent(id), count }))
    .filter((x): x is { event: EventItem; count: number } => !!x.event)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
