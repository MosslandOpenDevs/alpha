/**
 * Apply or roll back the audited UTC→KST why-moved repair.
 *
 * The default mode is read-only validation. Production writes require
 * `--apply`; rollback requires both `--rollback=<receipt>` and `--apply`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

type WhyMovedRow = {
  asset: string;
  date: string;
  title: string;
  one_line: string;
  why: string | null;
  points: string;
  pulses: string;
  sources: string;
  generated_at: string;
  cost_usd: number | null;
};

type AiRunRow = {
  id: string;
  input_hash: string;
  model: string;
  prompt_version: string;
  output_text: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
};

type SeoRow = {
  path: string;
  page_type: string;
  canonical_id: string | null;
  title: string | null;
  meta_description: string | null;
  index_policy: string;
  lastmod: string;
  generated_at: string;
  quality_score: number | null;
  raw_meta: string | null;
};

type RepairKey = {
  asset: string;
  date: string;
};

type AffectedKey = RepairKey & {
  classification: "stale" | "orphan";
  rowSha256: string;
  storedPulseIds: string[];
  expectedPulseIds: string[];
};

type TargetKey = RepairKey & {
  expectedPulseIds: string[];
};

type ParsedModelPayload = {
  title: string;
  oneLine: string;
  why: string;
  points: string[];
};

type AuditManifest = {
  schemaVersion: number;
  dbPath: string;
  dbFileSha256: string;
  pulseFilesSha256: string;
  pulseSnapshotSha256: string;
  counts: {
    pulses: number;
    invalidPulses: number;
    duplicatePulseIds: number;
    expectedKeys: number;
    storedRows: number;
    correct: number;
    stale: number;
    orphan: number;
    missing: number;
    relocatedMissingTargets: number;
  };
  affected: AffectedKey[];
  relocatedMissingTargetKeys: string[];
  relocatedMissingTargets: TargetKey[];
};

type Receipt = {
  schemaVersion: 1;
  status: "prepared" | "committed" | "rolled_back";
  preparedAt: string;
  committedAt?: string;
  rolledBackAt?: string;
  productionPath: string;
  manifestPath: string;
  manifestSha256: string;
  candidateAuditPath: string;
  candidateAuditSha256: string;
  preBackupPath: string;
  preBackupSha256: string;
  premergeBackupPath: string;
  premergeBackupSha256: string;
  candidatePath: string;
  candidateSha256: string;
  pulseFilesSha256: string;
  pulseSnapshotSha256: string;
  staleKeys: RepairKey[];
  orphanKeys: RepairKey[];
  targetKeys: RepairKey[];
  articleBeforeHashes: Record<string, string>;
  articleAfterHashes: Record<string, string>;
  seoBefore: Record<string, SeoRow | null>;
  seoAfterHashes: Record<string, string>;
  aiBefore: Record<string, AiRunRow | null>;
  aiAfterHashes: Record<string, string>;
  counts: {
    replacements: number;
    insertions: number;
    deletions: number;
    finalArticles: number;
    seoUpserts: number;
    seoDeletes: number;
    aiRunChanges: number;
  };
  receiptPayloadSha256: string;
};

const WHY_SELECT = `SELECT asset, date, title, one_line, why, points, pulses,
  sources, generated_at, cost_usd FROM alpha_why_moved`;
const AI_SELECT = `SELECT id, input_hash, model, prompt_version, output_text,
  input_tokens, output_tokens, cost_usd, created_at FROM alpha_ai_runs`;
const SEO_SELECT = `SELECT path, page_type, canonical_id, title,
  meta_description, index_policy, lastmod, generated_at, quality_score, raw_meta
  FROM alpha_seo_pages`;

function fail(message: string): never {
  throw new Error(message);
}

function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function requiredFlag(name: string): string {
  const value = flag(name);
  if (!value) fail(`--${name}=... is required`);
  return path.resolve(value);
}

function sha256Bytes(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function livePulseFilesSha256(): string {
  const micDataPath =
    process.env.MIC_DATA_PATH || path.join(process.cwd(), "mic-data");
  const pulseDir = path.join(micDataPath, "pulses");
  if (!fs.existsSync(pulseDir)) fail(`Pulse directory not found: ${pulseDir}`);
  const capture = () => {
    const files = fs
      .readdirSync(pulseDir)
      .filter((file) => !file.startsWith(".") && file.endsWith(".json"))
      .sort();
    if (files.length === 0) fail(`No pulse files found in ${pulseDir}`);
    const entries = files.map((file) => ({
      file,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(pulseDir, file)))
        .digest("hex"),
    }));
    const digest = crypto.createHash("sha256");
    for (const entry of entries) {
      digest
        .update(entry.file)
        .update("\0")
        .update(entry.sha256)
        .update("\n");
    }
    return { entries, sha256: digest.digest("hex") };
  };
  const first = capture();
  const second = capture();
  if (JSON.stringify(first.entries) !== JSON.stringify(second.entries)) {
    fail("Pulse files changed while the live snapshot was being read");
  }
  return first.sha256;
}

function assertNoActiveWal(databasePath: string, label: string): void {
  const walPath = `${databasePath}-wal`;
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    fail(`${label} has an active WAL; create a consolidated online backup`);
  }
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function fsyncDirectory(directory: string): void {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  fsyncDirectory(directory);
}

function writeJsonExclusive(file: string, value: unknown): void {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(directory);
}

function receiptPayloadHash(receipt: Receipt): string {
  const copy = { ...receipt } as Partial<Receipt>;
  delete copy.receiptPayloadSha256;
  return sha256Bytes(JSON.stringify(copy));
}

function keyOf(key: RepairKey): string {
  return JSON.stringify([key.asset, key.date]);
}

function assertUniqueKeys(label: string, keys: RepairKey[]): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (!key.asset || !/^\d{4}-\d{2}-\d{2}$/.test(key.date)) {
      fail(`${label} contains an invalid key: ${keyOf(key)}`);
    }
    const encoded = keyOf(key);
    if (seen.has(encoded)) fail(`${label} contains a duplicate key: ${encoded}`);
    seen.add(encoded);
  }
}

function canonicalWhyRow(row: WhyMovedRow): WhyMovedRow {
  return {
    asset: row.asset,
    date: row.date,
    title: row.title,
    one_line: row.one_line,
    why: row.why,
    points: row.points,
    pulses: row.pulses,
    sources: row.sources,
    generated_at: row.generated_at,
    cost_usd: row.cost_usd,
  };
}

function whyRowHash(row: WhyMovedRow): string {
  return sha256Bytes(JSON.stringify(canonicalWhyRow(row)));
}

function canonicalAiRow(row: AiRunRow): AiRunRow {
  return {
    id: row.id,
    input_hash: row.input_hash,
    model: row.model,
    prompt_version: row.prompt_version,
    output_text: row.output_text,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cost_usd: row.cost_usd,
    created_at: row.created_at,
  };
}

function aiRowHash(row: AiRunRow): string {
  return sha256Bytes(JSON.stringify(canonicalAiRow(row)));
}

function seoRowHash(row: SeoRow | null): string {
  return sha256Bytes(JSON.stringify(row));
}

function seoRowCasHash(row: SeoRow | null): string {
  if (!row) return sha256Bytes("null");
  const stable = {
    path: row.path,
    page_type: row.page_type,
    canonical_id: row.canonical_id,
    title: row.title,
    meta_description: row.meta_description,
    index_policy: row.index_policy,
    lastmod: row.lastmod,
    quality_score: row.quality_score,
    raw_meta: row.raw_meta,
  };
  return sha256Bytes(JSON.stringify(stable));
}

function sameStrings(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameStringRecord(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const normalize = (value: Record<string, string>) =>
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function parseModelPayload(content: string): ParsedModelPayload {
  const cleaned = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("model output is not an object");
  }
  const value = parsed as Record<string, unknown>;
  if (
    typeof value.title !== "string" ||
    !value.title.trim() ||
    typeof value.oneLine !== "string" ||
    !value.oneLine.trim() ||
    typeof value.why !== "string" ||
    !value.why.trim() ||
    !Array.isArray(value.points) ||
    value.points.length !== 5 ||
    !value.points.every(
      (point) => typeof point === "string" && point.trim().length > 0
    )
  ) {
    fail("model output does not match the why-moved schema");
  }
  return {
    title: value.title,
    oneLine: value.oneLine,
    why: value.why,
    points: value.points as string[],
  };
}

function validateArticle(row: WhyMovedRow, expectedPulseIds?: string[]): void {
  if (
    !row.asset ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    typeof row.one_line !== "string" ||
    !row.one_line.trim() ||
    typeof row.why !== "string" ||
    !row.why.trim() ||
    !Number.isFinite(Date.parse(row.generated_at)) ||
    typeof row.cost_usd !== "number" ||
    !Number.isFinite(row.cost_usd) ||
    row.cost_usd < 0
  ) {
    fail(`Invalid article scalar fields: ${keyOf(row)}`);
  }
  const points: unknown = JSON.parse(row.points);
  if (
    !Array.isArray(points) ||
    points.length !== 5 ||
    !points.every((point) => typeof point === "string" && point.trim())
  ) {
    fail(`Invalid article points: ${keyOf(row)}`);
  }
  const pulses: unknown = JSON.parse(row.pulses);
  if (!Array.isArray(pulses) || pulses.length === 0) {
    fail(`Invalid article pulses: ${keyOf(row)}`);
  }
  const pulseIds = pulses.map((pulse, index) => {
    if (
      !pulse ||
      typeof pulse !== "object" ||
      typeof (pulse as { id?: unknown }).id !== "string" ||
      !(pulse as { id: string }).id.trim()
    ) {
      fail(`Invalid pulse ${index} in article ${keyOf(row)}`);
    }
    return (pulse as { id: string }).id;
  });
  if (new Set(pulseIds).size !== pulseIds.length) {
    fail(`Duplicate pulse IDs in article ${keyOf(row)}`);
  }
  if (expectedPulseIds && !sameStrings(pulseIds, expectedPulseIds)) {
    fail(`Unexpected pulse IDs in article ${keyOf(row)}`);
  }
  const sources: unknown = JSON.parse(row.sources);
  if (
    !Array.isArray(sources) ||
    !sources.every(
      (source) =>
        !!source &&
        typeof source === "object" &&
        typeof (source as { url?: unknown }).url === "string" &&
        !!(source as { url: string }).url.trim()
    )
  ) {
    fail(`Invalid sources in article ${keyOf(row)}`);
  }
}

function articlePayloadSignature(row: WhyMovedRow): string {
  return JSON.stringify({
    title: row.title,
    oneLine: row.one_line,
    why: row.why,
    points: JSON.parse(row.points) as unknown,
  });
}

function quickCheck(db: Database.Database, label: string): void {
  const rows = db.pragma("quick_check") as Array<Record<string, unknown>>;
  if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok") {
    fail(`${label} quick_check failed: ${JSON.stringify(rows)}`);
  }
}

function getWhyRow(db: Database.Database, key: RepairKey): WhyMovedRow | null {
  return (
    (db
      .prepare(`${WHY_SELECT} WHERE asset = ? AND date = ?`)
      .get(key.asset, key.date) as WhyMovedRow | undefined) ?? null
  );
}

function getSeoRow(db: Database.Database, seoPath: string): SeoRow | null {
  return (
    (db.prepare(`${SEO_SELECT} WHERE path = ?`).get(seoPath) as
      | SeoRow
      | undefined) ?? null
  );
}

function assertManifest(manifest: AuditManifest): void {
  if (manifest.schemaVersion !== 3) fail("Repair manifest schemaVersion must be 3");
  if (
    manifest.counts.pulses !== 5400 ||
    manifest.counts.invalidPulses !== 0 ||
    manifest.counts.duplicatePulseIds !== 0 ||
    manifest.counts.storedRows !== 243 ||
    manifest.counts.stale !== 203 ||
    manifest.counts.orphan !== 2 ||
    manifest.counts.relocatedMissingTargets !== 22 ||
    manifest.affected.length !== 205 ||
    manifest.relocatedMissingTargets.length !== 22
  ) {
    fail(`Unexpected repair manifest counts: ${JSON.stringify(manifest.counts)}`);
  }
  assertUniqueKeys("affected", manifest.affected);
  assertUniqueKeys("relocatedMissingTargets", manifest.relocatedMissingTargets);
  const expectedTargetKeys = manifest.relocatedMissingTargets.map(keyOf).sort();
  const listedTargetKeys = manifest.relocatedMissingTargetKeys
    .map((value) => {
      const separator = value.indexOf("|");
      if (separator < 1) fail(`Invalid listed target key: ${value}`);
      return keyOf({ asset: value.slice(0, separator), date: value.slice(separator + 1) });
    })
    .sort();
  if (!sameStrings(expectedTargetKeys, listedTargetKeys)) {
    fail("Target key lists in the manifest disagree");
  }
  const affectedSet = new Set(manifest.affected.map(keyOf));
  for (const target of manifest.relocatedMissingTargets) {
    if (affectedSet.has(keyOf(target))) {
      fail(`Repair target overlaps an affected old key: ${keyOf(target)}`);
    }
    if (target.expectedPulseIds.length === 0) {
      fail(`Repair target has no expected pulses: ${keyOf(target)}`);
    }
  }
}

function assertCandidateAudit(
  original: AuditManifest,
  candidate: AuditManifest,
  candidatePath: string,
  candidateSha256: string
): void {
  if (
    candidate.schemaVersion !== 3 ||
    candidate.counts.pulses !== original.counts.pulses ||
    candidate.counts.invalidPulses !== 0 ||
    candidate.counts.duplicatePulseIds !== 0 ||
    candidate.counts.storedRows !== 263 ||
    candidate.counts.correct !== 263 ||
    candidate.counts.stale !== 0 ||
    candidate.counts.orphan !== 0 ||
    candidate.counts.missing !== 398 ||
    candidate.affected.length !== 0 ||
    path.resolve(candidate.dbPath) !== path.resolve(candidatePath) ||
    candidate.dbFileSha256 !== candidateSha256 ||
    candidate.pulseFilesSha256 !== original.pulseFilesSha256 ||
    candidate.pulseSnapshotSha256 !== original.pulseSnapshotSha256
  ) {
    fail(`Candidate audit is not merge-ready: ${JSON.stringify(candidate.counts)}`);
  }
}

function upsertWhy(db: Database.Database, row: WhyMovedRow): void {
  db.prepare(
    `INSERT INTO alpha_why_moved
      (asset, date, title, one_line, why, points, pulses, sources, generated_at, cost_usd)
     VALUES (@asset, @date, @title, @one_line, @why, @points, @pulses, @sources,
             @generated_at, @cost_usd)
     ON CONFLICT(asset, date) DO UPDATE SET
       title=excluded.title, one_line=excluded.one_line, why=excluded.why,
       points=excluded.points, pulses=excluded.pulses, sources=excluded.sources,
       generated_at=excluded.generated_at, cost_usd=excluded.cost_usd`
  ).run(row);
}

function upsertAi(db: Database.Database, row: AiRunRow): void {
  db.prepare(
    `INSERT INTO alpha_ai_runs
      (id, input_hash, model, prompt_version, output_text, input_tokens,
       output_tokens, cost_usd, created_at)
     VALUES (@id, @input_hash, @model, @prompt_version, @output_text,
             @input_tokens, @output_tokens, @cost_usd, @created_at)
     ON CONFLICT(input_hash) DO UPDATE SET
       id=excluded.id, model=excluded.model, prompt_version=excluded.prompt_version,
       output_text=excluded.output_text, input_tokens=excluded.input_tokens,
       output_tokens=excluded.output_tokens, cost_usd=excluded.cost_usd,
       created_at=excluded.created_at`
  ).run(row);
}

function upsertSeo(db: Database.Database, row: SeoRow): void {
  db.prepare(
    `INSERT INTO alpha_seo_pages
      (path, page_type, canonical_id, title, meta_description, index_policy,
       lastmod, generated_at, quality_score, raw_meta)
     VALUES (@path, @page_type, @canonical_id, @title, @meta_description,
             @index_policy, @lastmod, @generated_at, @quality_score, @raw_meta)
     ON CONFLICT(path) DO UPDATE SET
       page_type=excluded.page_type, canonical_id=excluded.canonical_id,
       title=excluded.title, meta_description=excluded.meta_description,
       index_policy=excluded.index_policy, lastmod=excluded.lastmod,
       generated_at=excluded.generated_at, quality_score=excluded.quality_score,
       raw_meta=excluded.raw_meta`
  ).run(row);
}

function seoForArticle(
  row: WhyMovedRow,
  generatedAt: string,
  rawMeta: string | null
): SeoRow {
  return {
    path: `/asset/${row.asset}/why-moved/${row.date}`,
    page_type: "event",
    canonical_id: `${row.asset}-${row.date}`,
    title: row.title,
    meta_description: row.one_line.slice(0, 200),
    index_policy: "index",
    lastmod: row.generated_at,
    generated_at: generatedAt,
    quality_score: 0.85,
    raw_meta: rawMeta,
  };
}

function assertSeoBackfillCompatible(current: SeoRow | null, expected: SeoRow): void {
  if (!current) return;
  if (
    current.page_type !== "event" ||
    current.canonical_id !== expected.canonical_id ||
    current.index_policy !== "index" ||
    current.quality_score !== 0.85
  ) {
    fail(`Existing SEO policy requires manual review: ${expected.path}`);
  }
}

function loadInputs() {
  const productionPath = path.resolve(
    process.env.DB_PATH || fail("DB_PATH is required")
  );
  const manifestPath = requiredFlag("manifest");
  const candidateAuditPath = requiredFlag("candidate-audit");
  const preBackupPath = requiredFlag("pre-backup");
  const premergeBackupPath = requiredFlag("premerge-backup");
  const candidatePath = requiredFlag("candidate");
  const receiptPath = requiredFlag("receipt");
  const files = [
    productionPath,
    manifestPath,
    candidateAuditPath,
    preBackupPath,
    premergeBackupPath,
    candidatePath,
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) fail(`Required file does not exist: ${file}`);
  }
  if (fs.existsSync(receiptPath)) {
    fail(`Receipt path must not exist: ${receiptPath}`);
  }
  const canonicalReceiptPath = path.join(
    fs.realpathSync(path.dirname(receiptPath)),
    path.basename(receiptPath)
  );
  const canonicalInputPaths = files.map((file) => fs.realpathSync(file));
  if (canonicalInputPaths.includes(canonicalReceiptPath)) {
    fail("Receipt path must differ from every input path");
  }
  const databasePaths = [productionPath, preBackupPath, premergeBackupPath, candidatePath].map(
    (file) => fs.realpathSync(file)
  );
  if (new Set(databasePaths).size !== databasePaths.length) {
    fail("Production, backup, premerge, and candidate DB paths must be distinct");
  }
  const databaseInodes = [
    productionPath,
    preBackupPath,
    premergeBackupPath,
    candidatePath,
  ].map((file) => {
    const stat = fs.statSync(file);
    return `${stat.dev}:${stat.ino}`;
  });
  if (new Set(databaseInodes).size !== databaseInodes.length) {
    fail("Production, backup, premerge, and candidate DB inodes must be distinct");
  }
  return {
    productionPath,
    manifestPath,
    candidateAuditPath,
    preBackupPath,
    premergeBackupPath,
    candidatePath,
    receiptPath,
  };
}

function validateAndApply(): void {
  const input = loadInputs();
  const apply = process.argv.slice(2).includes("--apply");
  const candidateHashBefore = sha256File(input.candidatePath);
  const manifest = readJson<AuditManifest>(input.manifestPath);
  const candidateAudit = readJson<AuditManifest>(input.candidateAuditPath);
  assertManifest(manifest);
  assertCandidateAudit(
    manifest,
    candidateAudit,
    input.candidatePath,
    candidateHashBefore
  );
  if (livePulseFilesSha256() !== manifest.pulseFilesSha256) {
    fail("Live pulse files no longer match the repair manifest");
  }

  const stale = manifest.affected.filter((entry) => entry.classification === "stale");
  const orphans = manifest.affected.filter((entry) => entry.classification === "orphan");
  const targets = manifest.relocatedMissingTargets;
  const expectedByKey = new Map<string, string[]>([
    ...stale.map((entry) => [keyOf(entry), entry.expectedPulseIds] as const),
    ...targets.map((entry) => [keyOf(entry), entry.expectedPulseIds] as const),
  ]);

  const pre = new Database(input.preBackupPath, { readonly: true, fileMustExist: true });
  const premerge = new Database(input.premergeBackupPath, {
    readonly: true,
    fileMustExist: true,
  });
  const candidate = new Database(input.candidatePath, {
    readonly: true,
    fileMustExist: true,
  });
  assertNoActiveWal(input.preBackupPath, "Pre backup");
  assertNoActiveWal(input.premergeBackupPath, "Premerge backup");
  assertNoActiveWal(input.candidatePath, "Candidate");
  quickCheck(pre, "pre backup");
  quickCheck(premerge, "premerge backup");
  quickCheck(candidate, "candidate");

  for (const entry of manifest.affected) {
    const row = getWhyRow(pre, entry);
    if (!row || whyRowHash(row) !== entry.rowSha256) {
      fail(`Pre-backup row hash mismatch: ${keyOf(entry)}`);
    }
    const premergeRow = getWhyRow(premerge, entry);
    if (!premergeRow || whyRowHash(premergeRow) !== entry.rowSha256) {
      fail(`Premerge-backup row hash mismatch: ${keyOf(entry)}`);
    }
  }
  for (const target of targets) {
    if (getWhyRow(premerge, target)) {
      fail(`Premerge backup unexpectedly contains target: ${keyOf(target)}`);
    }
  }

  const candidateRows = candidate.prepare(WHY_SELECT).all() as WhyMovedRow[];
  if (candidateRows.length !== 263) {
    fail(`Candidate must contain exactly 263 why-moved rows, got ${candidateRows.length}`);
  }
  const candidateByKey = new Map(candidateRows.map((row) => [keyOf(row), row]));
  for (const row of candidateRows) validateArticle(row, expectedByKey.get(keyOf(row)));
  for (const entry of [...stale, ...targets]) {
    if (!candidateByKey.has(keyOf(entry))) {
      fail(`Candidate is missing repair row: ${keyOf(entry)}`);
    }
  }
  for (const entry of orphans) {
    if (candidateByKey.has(keyOf(entry))) {
      fail(`Candidate still contains orphan row: ${keyOf(entry)}`);
    }
  }

  const preAiRows = pre.prepare(AI_SELECT).all() as AiRunRow[];
  const candidateAiRows = candidate.prepare(AI_SELECT).all() as AiRunRow[];
  const preAiByHash = new Map(preAiRows.map((row) => [row.input_hash, row]));
  const candidateAiByHash = new Map(
    candidateAiRows.map((row) => [row.input_hash, row])
  );
  for (const old of preAiRows) {
    const current = candidateAiByHash.get(old.input_hash);
    if (!current || aiRowHash(current) !== aiRowHash(old)) {
      fail(`Candidate altered a pre-existing AI run: ${old.input_hash}`);
    }
  }
  const changedAiRows = candidateAiRows.filter((row) => {
    const old = preAiByHash.get(row.input_hash);
    return !old || aiRowHash(old) !== aiRowHash(row);
  });
  if (changedAiRows.length !== stale.length + targets.length) {
    fail(`Expected 225 new AI runs, got ${changedAiRows.length}`);
  }
  const expectedPayloadCosts = new Map<string, number[]>();
  for (const entry of [...stale, ...targets]) {
    const article = candidateByKey.get(keyOf(entry))!;
    const signature = articlePayloadSignature(article);
    const costs = expectedPayloadCosts.get(signature) ?? [];
    costs.push(article.cost_usd!);
    expectedPayloadCosts.set(signature, costs);
  }
  const provenanceCosts = new Map<string, number[]>();
  let changedAiCostUsd = 0;
  for (const row of changedAiRows) {
    if (preAiByHash.has(row.input_hash)) {
      fail(`Repair may not replace an existing AI run: ${row.input_hash}`);
    }
    if (
      row.id !== row.input_hash ||
      row.prompt_version !== "why-moved-v1" ||
      !row.model ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      (row.input_tokens != null && (!Number.isInteger(row.input_tokens) || row.input_tokens < 0)) ||
      (row.output_tokens != null && (!Number.isInteger(row.output_tokens) || row.output_tokens < 0)) ||
      typeof row.cost_usd !== "number" ||
      !Number.isFinite(row.cost_usd) ||
      row.cost_usd < 0
    ) {
      fail(`Invalid changed AI run ${row.input_hash}`);
    }
    const signature = JSON.stringify(parseModelPayload(row.output_text));
    if (!expectedPayloadCosts.has(signature)) {
      fail(`AI output is not coupled to a repaired article: ${row.input_hash}`);
    }
    const costs = provenanceCosts.get(signature) ?? [];
    costs.push(row.cost_usd);
    provenanceCosts.set(signature, costs);
    changedAiCostUsd += row.cost_usd;
  }
  let repairedArticleCostUsd = 0;
  for (const [signature, articleCostsUnsorted] of expectedPayloadCosts) {
    const articleCosts = [...articleCostsUnsorted].sort((a, b) => a - b);
    const aiCosts = [...(provenanceCosts.get(signature) ?? [])].sort(
      (a, b) => a - b
    );
    if (
      articleCosts.length !== aiCosts.length ||
      articleCosts.some((cost, index) => Math.abs(cost - aiCosts[index]) > 1e-12)
    ) {
      fail("Repaired article costs do not match their AI provenance rows");
    }
    repairedArticleCostUsd += articleCosts.reduce((sum, cost) => sum + cost, 0);
  }
  if (
    changedAiCostUsd > 0.25 ||
    repairedArticleCostUsd > 0.25 ||
    Math.abs(changedAiCostUsd - repairedArticleCostUsd) > 1e-9
  ) {
    fail(`Repair AI cost exceeds $0.25: $${changedAiCostUsd.toFixed(6)}`);
  }

  const manifestHash = sha256File(input.manifestPath);
  const candidateAuditHash = sha256File(input.candidateAuditPath);
  const preHash = sha256File(input.preBackupPath);
  const premergeHash = sha256File(input.premergeBackupPath);
  if (
    path.resolve(manifest.dbPath) !== path.resolve(input.preBackupPath) ||
    manifest.dbFileSha256 !== preHash
  ) {
    fail("Repair manifest is not bound to the supplied pre-backup DB");
  }

  const prod = new Database(
    input.productionPath,
    apply
      ? { fileMustExist: true }
      : { readonly: true, fileMustExist: true }
  );
  prod.pragma("busy_timeout = 10000");
  quickCheck(prod, "production");

  const validateProductionCas = () => {
    for (const entry of manifest.affected) {
      const row = getWhyRow(prod, entry);
      if (!row || whyRowHash(row) !== entry.rowSha256) {
        fail(`Production CAS failed for ${keyOf(entry)}`);
      }
    }
    for (const target of targets) {
      if (getWhyRow(prod, target)) {
        fail(`Production target is no longer absent: ${keyOf(target)}`);
      }
    }
  };

  const seoPaths = [
    ...candidateRows.map((row) => `/asset/${row.asset}/why-moved/${row.date}`),
    ...orphans.map((row) => `/asset/${row.asset}/why-moved/${row.date}`),
  ];
  if (new Set(seoPaths).size !== seoPaths.length) fail("SEO repair paths overlap");

  const validateSeoPreflight = () => {
    for (const row of candidateRows) {
      const seoPath = `/asset/${row.asset}/why-moved/${row.date}`;
      const current = getSeoRow(prod, seoPath);
      const snapshot = getSeoRow(premerge, seoPath);
      assertSeoBackfillCompatible(
        current,
        seoForArticle(row, row.generated_at, current?.raw_meta ?? null)
      );
      if (
        snapshot &&
        (!current || seoRowCasHash(current) !== seoRowCasHash(snapshot))
      ) {
        fail(`Production SEO CAS failed for ${seoPath}`);
      }
    }
    for (const orphan of orphans) {
      const seoPath = `/asset/${orphan.asset}/why-moved/${orphan.date}`;
      const current = getSeoRow(prod, seoPath);
      const snapshot = getSeoRow(premerge, seoPath);
      if (
        snapshot &&
        (!current || seoRowCasHash(current) !== seoRowCasHash(snapshot))
      ) {
        fail(`Production orphan SEO CAS failed for ${seoPath}`);
      }
    }
  };

  if (!apply) {
    validateProductionCas();
    validateSeoPreflight();
    console.log(
      JSON.stringify(
        {
          mode: "validate-only",
          replacements: stale.length,
          insertions: targets.length,
          deletions: orphans.length,
          finalArticles: candidateRows.length,
          seoUpserts: candidateRows.length,
          seoDeletes: orphans.length,
          aiRunChanges: changedAiRows.length,
          candidateSha256: candidateHashBefore,
        },
        null,
        2
      )
    );
    prod.close();
    candidate.close();
    premerge.close();
    pre.close();
    return;
  }

  const preparedAt = new Date().toISOString();

  prod.exec("BEGIN IMMEDIATE");
  let receipt: Receipt;
  try {
    assertNoActiveWal(input.candidatePath, "Candidate");
    if (sha256File(input.candidatePath) !== candidateHashBefore) {
      fail("Candidate changed before the repair transaction");
    }
    if (livePulseFilesSha256() !== manifest.pulseFilesSha256) {
      fail("Live pulse files changed before the repair transaction");
    }
    validateProductionCas();
    validateSeoPreflight();

    const seoBefore: Record<string, SeoRow | null> = {};
    for (const seoPath of seoPaths) seoBefore[seoPath] = getSeoRow(prod, seoPath);

    const aiBefore: Record<string, AiRunRow | null> = {};
    for (const row of changedAiRows) {
      const current = (prod
        .prepare(`${AI_SELECT} WHERE input_hash = ?`)
        .get(row.input_hash) as AiRunRow | undefined) ?? null;
      if (current) fail(`Production AI run is no longer absent: ${row.input_hash}`);
      aiBefore[row.input_hash] = null;
    }

    for (const entry of stale) upsertWhy(prod, candidateByKey.get(keyOf(entry))!);
    for (const target of targets) upsertWhy(prod, candidateByKey.get(keyOf(target))!);
    for (const orphan of orphans) {
      const result = prod
        .prepare("DELETE FROM alpha_why_moved WHERE asset = ? AND date = ?")
        .run(orphan.asset, orphan.date);
      if (result.changes !== 1) fail(`Orphan delete failed: ${keyOf(orphan)}`);
    }
    for (const row of changedAiRows) {
      upsertAi(prod, row);
    }

    for (const row of candidateRows) {
      const seoPath = `/asset/${row.asset}/why-moved/${row.date}`;
      upsertSeo(
        prod,
        seoForArticle(row, preparedAt, seoBefore[seoPath]?.raw_meta ?? null)
      );
    }
    for (const orphan of orphans) {
      prod
        .prepare("DELETE FROM alpha_seo_pages WHERE path = ?")
        .run(`/asset/${orphan.asset}/why-moved/${orphan.date}`);
    }

    const articleAfterHashes: Record<string, string> = {};
    for (const row of candidateRows) {
      const current = getWhyRow(prod, row);
      if (!current || whyRowHash(current) !== whyRowHash(row)) {
        fail(`Post-write article verification failed: ${keyOf(row)}`);
      }
      articleAfterHashes[keyOf(row)] = whyRowHash(current);
    }
    for (const orphan of orphans) {
      if (getWhyRow(prod, orphan)) fail(`Orphan survived delete: ${keyOf(orphan)}`);
    }
    for (const row of candidateRows) {
      const expected = seoForArticle(
        row,
        preparedAt,
        seoBefore[`/asset/${row.asset}/why-moved/${row.date}`]?.raw_meta ?? null
      );
      const actual = getSeoRow(prod, expected.path);
      if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail(`Post-write SEO verification failed: ${expected.path}`);
      }
    }
    for (const orphan of orphans) {
      const seoPath = `/asset/${orphan.asset}/why-moved/${orphan.date}`;
      if (getSeoRow(prod, seoPath)) fail(`Orphan SEO row survived: ${seoPath}`);
    }
    if (livePulseFilesSha256() !== manifest.pulseFilesSha256) {
      fail("Live pulse files changed during the repair transaction");
    }
    const finalCount = (
      prod.prepare("SELECT COUNT(*) AS n FROM alpha_why_moved").get() as { n: number }
    ).n;
    if (finalCount !== 263) fail(`Production final article count is ${finalCount}`);

    const articleBeforeHashes = Object.fromEntries(
      manifest.affected.map((entry) => [keyOf(entry), entry.rowSha256])
    );
    const seoAfterHashes = Object.fromEntries(
      seoPaths.map((seoPath) => [
        seoPath,
        seoRowCasHash(getSeoRow(prod, seoPath)),
      ])
    );
    const aiAfterHashes = Object.fromEntries(
      changedAiRows.map((row) => [row.input_hash, aiRowHash(row)])
    );
    receipt = {
      schemaVersion: 1,
      status: "prepared",
      preparedAt,
      productionPath: input.productionPath,
      manifestPath: input.manifestPath,
      manifestSha256: manifestHash,
      candidateAuditPath: input.candidateAuditPath,
      candidateAuditSha256: candidateAuditHash,
      preBackupPath: input.preBackupPath,
      preBackupSha256: preHash,
      premergeBackupPath: input.premergeBackupPath,
      premergeBackupSha256: premergeHash,
      candidatePath: input.candidatePath,
      candidateSha256: candidateHashBefore,
      pulseFilesSha256: manifest.pulseFilesSha256,
      pulseSnapshotSha256: manifest.pulseSnapshotSha256,
      staleKeys: stale.map(({ asset, date }) => ({ asset, date })),
      orphanKeys: orphans.map(({ asset, date }) => ({ asset, date })),
      targetKeys: targets.map(({ asset, date }) => ({ asset, date })),
      articleBeforeHashes,
      articleAfterHashes,
      seoBefore,
      seoAfterHashes,
      aiBefore,
      aiAfterHashes,
      counts: {
        replacements: stale.length,
        insertions: targets.length,
        deletions: orphans.length,
        finalArticles: finalCount,
        seoUpserts: candidateRows.length,
        seoDeletes: orphans.length,
        aiRunChanges: changedAiRows.length,
      },
      receiptPayloadSha256: "",
    };
    receipt.receiptPayloadSha256 = receiptPayloadHash(receipt);
    writeJsonExclusive(input.receiptPath, receipt);
    assertNoActiveWal(input.candidatePath, "Candidate");
    if (sha256File(input.candidatePath) !== candidateHashBefore) {
      fail("Candidate changed during the repair transaction");
    }
    if (livePulseFilesSha256() !== manifest.pulseFilesSha256) {
      fail("Live pulse files changed before commit");
    }
    prod.exec("COMMIT");
  } catch (error) {
    if (prod.inTransaction) prod.exec("ROLLBACK");
    throw error;
  }

  receipt.status = "committed";
  receipt.committedAt = new Date().toISOString();
  receipt.receiptPayloadSha256 = receiptPayloadHash(receipt);
  writeJsonAtomic(input.receiptPath, receipt);
  quickCheck(prod, "production after commit");
  if (sha256File(input.candidatePath) !== candidateHashBefore) {
    fail("Candidate changed while the repair was being applied");
  }
  console.log(JSON.stringify(receipt.counts, null, 2));
  console.log(`Receipt: ${input.receiptPath}`);

  prod.close();
  candidate.close();
  premerge.close();
  pre.close();
}

function rollback(): void {
  const receiptPath = requiredFlag("rollback");
  if (!process.argv.slice(2).includes("--apply")) {
    fail("Rollback writes require --apply");
  }
  const receipt = readJson<Receipt>(receiptPath);
  if (
    receipt.schemaVersion !== 1 ||
    !["prepared", "committed", "rolled_back"].includes(receipt.status)
  ) {
    fail("Unsupported repair receipt status or schema version");
  }
  if (receipt.receiptPayloadSha256 !== receiptPayloadHash(receipt)) {
    fail("Repair receipt payload hash mismatch");
  }
  const productionPath = path.resolve(
    process.env.DB_PATH || fail("DB_PATH is required")
  );
  if (productionPath !== path.resolve(receipt.productionPath)) {
    fail("DB_PATH does not match the receipt production path");
  }
  if (
    sha256File(receipt.preBackupPath) !== receipt.preBackupSha256 ||
    sha256File(receipt.manifestPath) !== receipt.manifestSha256 ||
    sha256File(receipt.premergeBackupPath) !== receipt.premergeBackupSha256 ||
    sha256File(receipt.candidatePath) !== receipt.candidateSha256 ||
    sha256File(receipt.candidateAuditPath) !== receipt.candidateAuditSha256
  ) {
    fail("Rollback source hashes do not match the receipt");
  }
  const manifest = readJson<AuditManifest>(receipt.manifestPath);
  assertManifest(manifest);
  if (
    receipt.pulseFilesSha256 !== manifest.pulseFilesSha256 ||
    receipt.pulseSnapshotSha256 !== manifest.pulseSnapshotSha256
  ) {
    fail("Receipt pulse snapshot does not match its manifest");
  }
  const expectedStale = manifest.affected.filter(
    (entry) => entry.classification === "stale"
  );
  const expectedOrphans = manifest.affected.filter(
    (entry) => entry.classification === "orphan"
  );
  const expectedTargets = manifest.relocatedMissingTargets;
  if (
    !sameStrings(receipt.staleKeys.map(keyOf), expectedStale.map(keyOf)) ||
    !sameStrings(receipt.orphanKeys.map(keyOf), expectedOrphans.map(keyOf)) ||
    !sameStrings(receipt.targetKeys.map(keyOf), expectedTargets.map(keyOf))
  ) {
    fail("Receipt repair key sets do not match the manifest");
  }
  const expectedBeforeHashes = Object.fromEntries(
    manifest.affected.map((entry) => [keyOf(entry), entry.rowSha256])
  );
  if (!sameStringRecord(receipt.articleBeforeHashes, expectedBeforeHashes)) {
    fail("Receipt before hashes do not match the manifest");
  }
  if (
    receipt.counts.replacements !== expectedStale.length ||
    receipt.counts.insertions !== expectedTargets.length ||
    receipt.counts.deletions !== expectedOrphans.length ||
    receipt.counts.finalArticles !== 263 ||
    receipt.counts.seoUpserts !== 263 ||
    receipt.counts.seoDeletes !== expectedOrphans.length ||
    receipt.counts.aiRunChanges !== 225
  ) {
    fail("Receipt counts are inconsistent with the repair manifest");
  }
  const pre = new Database(receipt.preBackupPath, {
    readonly: true,
    fileMustExist: true,
  });
  quickCheck(pre, "rollback pre backup");
  const candidate = new Database(receipt.candidatePath, {
    readonly: true,
    fileMustExist: true,
  });
  quickCheck(candidate, "rollback candidate");
  const premerge = new Database(receipt.premergeBackupPath, {
    readonly: true,
    fileMustExist: true,
  });
  quickCheck(premerge, "rollback premerge backup");
  const candidateRows = candidate.prepare(WHY_SELECT).all() as WhyMovedRow[];
  const expectedAfterHashes = Object.fromEntries(
    candidateRows.map((row) => [keyOf(row), whyRowHash(row)])
  );
  if (
    candidateRows.length !== 263 ||
    !sameStringRecord(receipt.articleAfterHashes, expectedAfterHashes)
  ) {
    fail("Receipt after hashes do not match the repair candidate");
  }
  const expectedSeoPaths = [
    ...candidateRows.map((row) => `/asset/${row.asset}/why-moved/${row.date}`),
    ...expectedOrphans.map(
      (row) => `/asset/${row.asset}/why-moved/${row.date}`
    ),
  ].sort();
  if (
    !sameStrings(Object.keys(receipt.seoBefore), expectedSeoPaths) ||
    !sameStrings(Object.keys(receipt.seoAfterHashes), expectedSeoPaths)
  ) {
    fail("Receipt SEO path sets do not match the repair candidate");
  }
  for (const seoPath of expectedSeoPaths) {
    const snapshot = getSeoRow(premerge, seoPath);
    if (
      snapshot &&
      seoRowCasHash(snapshot) !== seoRowCasHash(receipt.seoBefore[seoPath])
    ) {
      fail(`Receipt SEO before-state disagrees with premerge backup: ${seoPath}`);
    }
  }
  const candidateAiByHash = new Map(
    (candidate.prepare(AI_SELECT).all() as AiRunRow[]).map((row) => [
      row.input_hash,
      row,
    ])
  );
  const aiKeys = Object.keys(receipt.aiAfterHashes);
  if (
    aiKeys.length !== 225 ||
    !sameStrings(Object.keys(receipt.aiBefore), aiKeys)
  ) {
    fail("Receipt AI key sets are inconsistent");
  }
  for (const inputHash of aiKeys) {
    const candidateRow = candidateAiByHash.get(inputHash);
    if (
      receipt.aiBefore[inputHash] !== null ||
      !candidateRow ||
      aiRowHash(candidateRow) !== receipt.aiAfterHashes[inputHash] ||
      pre
        .prepare(`${AI_SELECT} WHERE input_hash = ?`)
        .get(inputHash)
    ) {
      fail(`Receipt AI provenance is inconsistent for ${inputHash}`);
    }
  }
  const prod = new Database(productionPath, { fileMustExist: true });
  prod.pragma("busy_timeout = 10000");
  quickCheck(prod, "production before rollback");
  prod.exec("BEGIN IMMEDIATE");
  try {
    const articlesAtBeforeState = Object.entries(
      receipt.articleBeforeHashes
    ).every(([encoded, expectedHash]) => {
      const [asset, date] = JSON.parse(encoded) as [string, string];
      const row = getWhyRow(prod, { asset, date });
      return !!row && whyRowHash(row) === expectedHash;
    });
    const targetsAtBeforeState = receipt.targetKeys.every(
      (target) => !getWhyRow(prod, target)
    );
    const seoAtBeforeState = Object.entries(receipt.seoBefore).every(
      ([seoPath, before]) =>
        seoRowCasHash(getSeoRow(prod, seoPath)) === seoRowCasHash(before)
    );
    const aiAtBeforeState = Object.entries(receipt.aiBefore).every(
      ([inputHash, before]) => {
        const current = (prod
          .prepare(`${AI_SELECT} WHERE input_hash = ?`)
          .get(inputHash) as AiRunRow | undefined) ?? null;
        return before
          ? !!current && aiRowHash(current) === aiRowHash(before)
          : current === null;
      }
    );
    if (
      articlesAtBeforeState &&
      targetsAtBeforeState &&
      seoAtBeforeState &&
      aiAtBeforeState
    ) {
      prod.exec("ROLLBACK");
      receipt.status = "rolled_back";
      receipt.rolledBackAt ??= new Date().toISOString();
      receipt.receiptPayloadSha256 = receiptPayloadHash(receipt);
      writeJsonAtomic(receiptPath, receipt);
      console.log(`Rollback already complete for receipt ${receiptPath}`);
      prod.close();
      candidate.close();
      premerge.close();
      pre.close();
      return;
    }
    if (receipt.status === "rolled_back") {
      fail("Receipt says rolled_back but production does not match before-state");
    }
    const startCount = (
      prod.prepare("SELECT COUNT(*) AS n FROM alpha_why_moved").get() as { n: number }
    ).n;
    for (const [encoded, expectedHash] of Object.entries(
      receipt.articleAfterHashes
    )) {
      const [asset, date] = JSON.parse(encoded) as [string, string];
      const row = getWhyRow(prod, { asset, date });
      if (!row || whyRowHash(row) !== expectedHash) {
        fail(`Rollback CAS failed for ${encoded}`);
      }
    }
    for (const orphan of receipt.orphanKeys) {
      if (getWhyRow(prod, orphan)) fail(`Rollback orphan unexpectedly exists: ${keyOf(orphan)}`);
    }
    for (const [inputHash, expectedHash] of Object.entries(
      receipt.aiAfterHashes
    )) {
      const current = (prod
        .prepare(`${AI_SELECT} WHERE input_hash = ?`)
        .get(inputHash) as AiRunRow | undefined) ?? null;
      if (!current || aiRowHash(current) !== expectedHash) {
        fail(`Rollback AI run CAS failed for ${inputHash}`);
      }
    }
    for (const [seoPath, expectedHash] of Object.entries(
      receipt.seoAfterHashes
    )) {
      if (seoRowCasHash(getSeoRow(prod, seoPath)) !== expectedHash) {
        fail(`Rollback SEO CAS failed for ${seoPath}`);
      }
    }

    for (const key of [...receipt.staleKeys, ...receipt.orphanKeys]) {
      const original = getWhyRow(pre, key);
      if (!original) fail(`Rollback source row is missing: ${keyOf(key)}`);
      upsertWhy(prod, original);
    }
    for (const target of receipt.targetKeys) {
      prod
        .prepare("DELETE FROM alpha_why_moved WHERE asset = ? AND date = ?")
        .run(target.asset, target.date);
    }
    for (const [seoPath, before] of Object.entries(receipt.seoBefore)) {
      if (before) upsertSeo(prod, before);
      else prod.prepare("DELETE FROM alpha_seo_pages WHERE path = ?").run(seoPath);
    }
    for (const [inputHash, before] of Object.entries(receipt.aiBefore)) {
      if (before) upsertAi(prod, before);
      else
        prod
          .prepare("DELETE FROM alpha_ai_runs WHERE input_hash = ?")
          .run(inputHash);
    }

    const restoredCount = (
      prod.prepare("SELECT COUNT(*) AS n FROM alpha_why_moved").get() as { n: number }
    ).n;
    const expectedRestoredCount =
      startCount - receipt.targetKeys.length + receipt.orphanKeys.length;
    if (restoredCount !== expectedRestoredCount) {
      fail(
        `Rollback article count is ${restoredCount}, expected ${expectedRestoredCount}`
      );
    }
    for (const encoded of Object.keys(receipt.articleBeforeHashes)) {
      const [asset, date] = JSON.parse(encoded) as [string, string];
      const row = getWhyRow(prod, { asset, date });
      if (!row || whyRowHash(row) !== receipt.articleBeforeHashes[encoded]) {
        fail(`Rollback article verification failed for ${encoded}`);
      }
    }
    for (const target of receipt.targetKeys) {
      if (getWhyRow(prod, target)) {
        fail(`Rollback target survived delete: ${keyOf(target)}`);
      }
    }
    for (const [seoPath, before] of Object.entries(receipt.seoBefore)) {
      if (seoRowHash(getSeoRow(prod, seoPath)) !== seoRowHash(before)) {
        fail(`Rollback SEO verification failed for ${seoPath}`);
      }
    }
    for (const [inputHash, before] of Object.entries(receipt.aiBefore)) {
      const current = (prod
        .prepare(`${AI_SELECT} WHERE input_hash = ?`)
        .get(inputHash) as AiRunRow | undefined) ?? null;
      if (
        (before && (!current || aiRowHash(current) !== aiRowHash(before))) ||
        (!before && current)
      ) {
        fail(`Rollback AI verification failed for ${inputHash}`);
      }
    }
    prod.exec("COMMIT");
  } catch (error) {
    if (prod.inTransaction) prod.exec("ROLLBACK");
    throw error;
  }
  receipt.status = "rolled_back";
  receipt.rolledBackAt = new Date().toISOString();
  receipt.receiptPayloadSha256 = receiptPayloadHash(receipt);
  writeJsonAtomic(receiptPath, receipt);
  quickCheck(prod, "production after rollback");
  console.log(`Rolled back using receipt ${receiptPath}`);
  prod.close();
  candidate.close();
  premerge.close();
  pre.close();
}

try {
  if (flag("rollback")) rollback();
  else validateAndApply();
} catch (error) {
  console.error(error);
  process.exit(1);
}
