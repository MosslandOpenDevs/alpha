/**
 * 통합 검색 — entities + topics + events + creators.
 *
 * 알고리즘: 정확 일치 → 별칭 일치 → 부분 문자열. 임베딩 유사도는
 * Phase 2+ (Grok 호출 필요).
 */

import {
  getAllEntities,
  getAllTopics,
  getAllEvents,
  type Entity,
  type Topic,
  type EventItem,
} from "./mic";
import { getActiveChannels, type Channel } from "./creators";

export type SearchHit =
  | { kind: "entity"; item: Entity; href: string; score: number }
  | { kind: "topic"; item: Topic; href: string; score: number }
  | { kind: "event"; item: EventItem; href: string; score: number }
  | { kind: "creator"; item: Channel; href: string; score: number };

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function scoreMatch(query: string, target: string, aliases: string[]): number {
  const q = normalize(query);
  const t = normalize(target);
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 50;
  for (const alias of aliases || []) {
    const a = normalize(alias);
    if (a === q) return 90;
    if (a.startsWith(q)) return 70;
    if (a.includes(q)) return 40;
  }
  return 0;
}

export function search(query: string, limit = 30): SearchHit[] {
  if (!query || query.length < 1) return [];
  const hits: SearchHit[] = [];

  for (const e of getAllEntities()) {
    const score = scoreMatch(query, e.label, e.aliases);
    if (score > 0) {
      const href =
        e.type === "asset"
          ? `/asset/${e.id}`
          : `/entity/${encodeURIComponent(e.id)}`;
      hits.push({
        kind: "entity",
        item: e,
        href,
        score: score + Math.min(20, e.videoCount),
      });
    }
  }

  for (const t of getAllTopics()) {
    const score = scoreMatch(query, t.label, t.aliases);
    if (score > 0) {
      hits.push({
        kind: "topic",
        item: t,
        href: `/topic/${encodeURIComponent(t.id)}`,
        score: score + Math.min(20, t.videoCount),
      });
    }
  }

  for (const ev of getAllEvents()) {
    const score = scoreMatch(query, ev.label, ev.aliases);
    if (score > 0) {
      hits.push({
        kind: "event",
        item: ev,
        href: `/event/${encodeURIComponent(ev.id)}`,
        score: score + Math.min(20, ev.videoCount),
      });
    }
  }

  for (const c of getActiveChannels()) {
    if (!c.youtube_channel_id) continue;
    const score = scoreMatch(query, c.name, []);
    if (score > 0) {
      hits.push({
        kind: "creator",
        item: c,
        href: `/creator/${c.youtube_channel_id}`,
        score,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
