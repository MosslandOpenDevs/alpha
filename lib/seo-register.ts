/**
 * Auto-register the current route into alpha_seo_pages on render.
 * Call from server components / route handlers.
 *
 * Index policy gating (alpha_dev_plan §2.2 노 index 정책):
 *   - quality_score < 0.3 → noindex (sparse data)
 *   - explicit override via 3rd arg
 */

import { upsertSeoPage, type SeoPage } from "./db";
import { isoNow } from "./seo";

export type RegisterArgs = {
  path: string;
  page_type: SeoPage["page_type"];
  canonical_id?: string | null;
  title: string;
  meta_description?: string | null;
  /** 0-1, used to gate noindex when sparse */
  quality_score?: number;
  /** override automatic decision */
  index_policy?: SeoPage["index_policy"];
  /** custom lastmod, defaults to now */
  lastmod?: string;
};

const SPARSE_THRESHOLD = 0.3;

export function registerSeoPage(args: RegisterArgs): SeoPage["index_policy"] {
  const quality = args.quality_score ?? 0.5;
  const policy: SeoPage["index_policy"] =
    args.index_policy ??
    (quality < SPARSE_THRESHOLD ? "noindex" : "index");

  upsertSeoPage({
    path: args.path,
    page_type: args.page_type,
    canonical_id: args.canonical_id ?? null,
    title: args.title,
    meta_description: args.meta_description ?? null,
    index_policy: policy,
    lastmod: args.lastmod ?? isoNow(),
    generated_at: isoNow(),
    quality_score: quality,
  });
  return policy;
}
