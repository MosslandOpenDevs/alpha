/**
 * Creator (channel) consumer.
 *
 * Reads signalmap seed/channels.json + yt-*.json to build channel
 * fingerprints (어떤 entity에 어떤 stance).
 *
 * Cache: channel index lazy-built once, full reindex on canonical refresh.
 */

import fs from "node:fs";
import path from "node:path";
import { getVideo, type VideoRecord } from "./mic";

const SIGNALMAP_ROOT =
  process.env.SIGNALMAP_ROOT ||
  "<SIGNALMAP_ROOT>";

const SEED_PATH = path.join(SIGNALMAP_ROOT, "seed/channels.json");
const OUTPUT_PATH = path.join(SIGNALMAP_ROOT, "samples/output");

export type Channel = {
  name: string;
  category: "economy" | "tech" | "news" | "science" | string;
  stance: "left" | "right" | "center" | "observer" | "n/a" | string;
  language: "ko" | "en" | string;
  youtube_channel_id: string | null;
  youtube_handle: string | null;
  notes?: string;
};

let _channelsCache: { data: Channel[]; loadedAt: number } | null = null;
let _channelVideosCache: Map<string, string[]> | null = null;
let _channelVideosLoadedAt = 0;
const TTL_MS = 10 * 60 * 1000;

export function getAllChannels(): Channel[] {
  if (_channelsCache && Date.now() - _channelsCache.loadedAt < TTL_MS) {
    return _channelsCache.data;
  }
  if (!fs.existsSync(SEED_PATH)) return [];
  const raw = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  const channels = (raw.channels || []) as Channel[];
  _channelsCache = { data: channels, loadedAt: Date.now() };
  return channels;
}

export function getChannel(channelId: string): Channel | null {
  return getAllChannels().find((c) => c.youtube_channel_id === channelId) || null;
}

/**
 * One-time scan of all yt-*.json filenames → channel_id index.
 * Reads only meta.channel_id from each file (lightweight).
 */
function buildChannelVideoIndex(): Map<string, string[]> {
  if (_channelVideosCache && Date.now() - _channelVideosLoadedAt < TTL_MS) {
    return _channelVideosCache;
  }
  const index = new Map<string, string[]>();
  if (!fs.existsSync(OUTPUT_PATH)) {
    _channelVideosCache = index;
    _channelVideosLoadedAt = Date.now();
    return index;
  }
  const files = fs.readdirSync(OUTPUT_PATH).filter((f) => f.startsWith("yt-") && f.endsWith(".json"));
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(OUTPUT_PATH, f), "utf8")) as {
        meta?: { channel_id?: string };
        source?: { videoId?: string };
      };
      const channelId = raw.meta?.channel_id;
      const videoId = raw.source?.videoId || f.replace(/^yt-/, "").replace(/\.json$/, "");
      if (channelId) {
        if (!index.has(channelId)) index.set(channelId, []);
        index.get(channelId)!.push(videoId);
      }
    } catch {
      // skip malformed
    }
  }
  _channelVideosCache = index;
  _channelVideosLoadedAt = Date.now();
  return index;
}

export function getVideosByChannel(channelId: string, limit = 30): VideoRecord[] {
  const index = buildChannelVideoIndex();
  const videoIds = index.get(channelId) || [];
  const recs = videoIds
    .map((id) => getVideo(id))
    .filter((v): v is VideoRecord => !!v);
  recs.sort((a, b) => {
    const ta = a.meta.published_at ? Date.parse(a.meta.published_at) : 0;
    const tb = b.meta.published_at ? Date.parse(b.meta.published_at) : 0;
    return tb - ta;
  });
  return recs.slice(0, limit);
}

export type ChannelFingerprint = {
  channel: Channel;
  videoCount: number;
  topEntityIds: { id: string; count: number }[];
  topTopicIds: { id: string; count: number }[];
};

export function getChannelFingerprint(channelId: string): ChannelFingerprint | null {
  const channel = getChannel(channelId);
  if (!channel) return null;
  const videos = getVideosByChannel(channelId, 200);

  const entityCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  for (const v of videos) {
    for (const eid of v.canonical_entity_ids || []) {
      entityCounts.set(eid, (entityCounts.get(eid) || 0) + 1);
    }
    if (v.canonical_topic_id) {
      topicCounts.set(
        v.canonical_topic_id,
        (topicCounts.get(v.canonical_topic_id) || 0) + 1
      );
    }
  }

  const topEntityIds = [...entityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([id, count]) => ({ id, count }));

  const topTopicIds = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ id, count }));

  return {
    channel,
    videoCount: videos.length,
    topEntityIds,
    topTopicIds,
  };
}

export function getActiveChannels(): Channel[] {
  const index = buildChannelVideoIndex();
  return getAllChannels().filter((c) => {
    if (!c.youtube_channel_id) return false;
    return (index.get(c.youtube_channel_id) || []).length > 0;
  });
}
