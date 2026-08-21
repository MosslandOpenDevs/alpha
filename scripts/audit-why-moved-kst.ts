/**
 * Audit why-moved cache keys and embedded pulse IDs against KST calendar days.
 *
 * Read-only. Emits a manifest that scripts/apply-why-moved-kst-repair.ts
 * binds to by path + sha256; see that file's header for the full runbook.
 *
 * Usage:
 *   DB_PATH=<db> pnpm tsx scripts/audit-why-moved-kst.ts
 *   DB_PATH=<db> pnpm tsx scripts/audit-why-moved-kst.ts --out=/secure/path/manifest.json
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadScriptEnv } from "../lib/script-env";

loadScriptEnv();

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

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function sameValues(left: string[], right: string[]): boolean {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hashRow(row: WhyMovedRow): string {
  return crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

async function main() {
  const outFlag = process.argv.slice(2).find((arg) => arg.startsWith("--out="));
  const outFile = outFlag ? path.resolve(outFlag.slice("--out=".length)) : null;
  const dbPath = process.env.DB_PATH;
  if (!dbPath) throw new Error("DB_PATH is required");

  const Database = (await import("better-sqlite3")).default;
  const { formatPulseLoadDiagnostics, getAllPulses, getPulseLoadDiagnostics } =
    await import("../lib/mic");
  const { kstDateForTimestamp } = await import("../lib/why-moved");

  const micDataPath =
    process.env.MIC_DATA_PATH || path.join(process.cwd(), "mic-data");
  const pulseDir = path.join(micDataPath, "pulses");
  if (!fs.existsSync(pulseDir)) {
    throw new Error(`Pulse directory not found: ${pulseDir}`);
  }
  const pulseFiles = fs
    .readdirSync(pulseDir)
    .filter((file) => !file.startsWith(".") && file.endsWith(".json"))
    .sort();
  if (pulseFiles.length === 0) {
    throw new Error(`No pulse JSON files found in ${pulseDir}`);
  }
  const rawPulseIds = new Set<string>();
  const pulseFileHashes: Array<{ file: string; sha256: string }> = [];
  const pulseFileDigest = crypto.createHash("sha256");
  for (const file of pulseFiles) {
    const bytes = fs.readFileSync(path.join(pulseDir, file));
    const fileSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    pulseFileHashes.push({ file, sha256: fileSha256 });
    pulseFileDigest.update(file).update("\0");
    pulseFileDigest.update(fileSha256);
    pulseFileDigest.update("\n");
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`Malformed pulse JSON ${file}: ${(error as Error).message}`);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Pulse ${file} must contain a JSON object`);
    }
    const pulse = raw as Record<string, unknown>;
    if (
      typeof pulse.id !== "string" ||
      !pulse.id.trim() ||
      typeof pulse.asset !== "string" ||
      !pulse.asset.trim() ||
      typeof pulse.detectedAt !== "string" ||
      !Number.isFinite(Date.parse(pulse.detectedAt)) ||
      typeof pulse.magnitudePct !== "number" ||
      !Number.isFinite(pulse.magnitudePct) ||
      typeof pulse.summary !== "string"
    ) {
      throw new Error(`Pulse ${file} is missing required fields`);
    }
    if (rawPulseIds.has(pulse.id)) {
      throw new Error(`Duplicate pulse id ${pulse.id} in ${file}`);
    }
    rawPulseIds.add(pulse.id);
  }

  const pulses = getAllPulses();
  if (pulses.length !== pulseFiles.length) {
    // The loader's schema check is stricter than the pre-scan above, so name
    // the files it rejected instead of reporting a bare count difference.
    throw new Error(
      `Pulse loader mismatch: files=${pulseFiles.length} loaded=${pulses.length}; ` +
        formatPulseLoadDiagnostics(getPulseLoadDiagnostics())
    );
  }
  const loadedPulseIds = sorted(pulses.map((pulse) => pulse.id));
  if (!sameValues(loadedPulseIds, sorted([...rawPulseIds]))) {
    throw new Error("Pulse loader IDs do not match the raw pulse snapshot");
  }
  const pulseFilesAfter = fs
    .readdirSync(pulseDir)
    .filter((file) => !file.startsWith(".") && file.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(pulseDir, file)))
        .digest("hex"),
    }));
  if (JSON.stringify(pulseFilesAfter) !== JSON.stringify(pulseFileHashes)) {
    throw new Error("Pulse files changed while the audit snapshot was being read");
  }
  const pulseSnapshotSha256 = crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        [...pulses].sort(
          (a, b) => a.id.localeCompare(b.id) || a.detectedAt.localeCompare(b.detectedAt)
        )
      )
    )
    .digest("hex");
  const expected = new Map<string, string[]>();
  const targetKeyByPulseId = new Map<string, string>();
  const invalidPulseIds: string[] = [];
  const duplicatePulseIds = new Set<string>();
  for (const pulse of pulses) {
    if (targetKeyByPulseId.has(pulse.id)) duplicatePulseIds.add(pulse.id);
    const date = kstDateForTimestamp(pulse.detectedAt);
    if (!date || !pulse.asset) {
      invalidPulseIds.push(pulse.id);
      continue;
    }
    const key = `${pulse.asset.toLowerCase()}|${date}`;
    targetKeyByPulseId.set(pulse.id, key);
    const ids = expected.get(key);
    if (ids) ids.push(pulse.id);
    else expected.set(key, [pulse.id]);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db.prepare("SELECT * FROM alpha_why_moved").all() as WhyMovedRow[];
  db.close();
  const walPath = `${dbPath}-wal`;
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    throw new Error("Audit DB has an active WAL; audit an online backup instead");
  }
  const dbFileSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(dbPath))
    .digest("hex");

  const storedKeys = new Set<string>();
  const affected: Array<{
    asset: string;
    date: string;
    classification: "stale" | "orphan";
    rowSha256: string;
    storedPulseIds: string[];
    expectedPulseIds: string[];
    generatedAt: string;
    parseError?: string;
  }> = [];
  const relocatedTargetKeys = new Set<string>();
  let correct = 0;

  for (const row of rows) {
    const key = `${row.asset.toLowerCase()}|${row.date}`;
    storedKeys.add(key);
    const expectedPulseIds = expected.get(key) ?? [];
    let storedPulseIds: string[] = [];
    let parseError: string | undefined;
    try {
      const parsed: unknown = JSON.parse(row.pulses);
      if (!Array.isArray(parsed)) {
        throw new Error("pulses must be a JSON array");
      }
      storedPulseIds = parsed.map((pulse, index) => {
        if (
          !pulse ||
          typeof pulse !== "object" ||
          typeof (pulse as { id?: unknown }).id !== "string" ||
          !(pulse as { id: string }).id.trim()
        ) {
          throw new Error(`pulses[${index}].id must be a non-empty string`);
        }
        return (pulse as { id: string }).id;
      });
      if (new Set(storedPulseIds).size !== storedPulseIds.length) {
        throw new Error("pulses contains duplicate IDs");
      }
    } catch (error) {
      parseError = (error as Error).message;
    }

    if (!parseError && expectedPulseIds.length > 0 && sameValues(storedPulseIds, expectedPulseIds)) {
      correct++;
      continue;
    }

    affected.push({
      asset: row.asset,
      date: row.date,
      classification: expectedPulseIds.length > 0 ? "stale" : "orphan",
      rowSha256: hashRow(row),
      storedPulseIds: sorted(storedPulseIds),
      expectedPulseIds: sorted(expectedPulseIds),
      generatedAt: row.generated_at,
      ...(parseError ? { parseError } : {}),
    });
    for (const pulseId of storedPulseIds) {
      const targetKey = targetKeyByPulseId.get(pulseId);
      if (targetKey && targetKey !== key) relocatedTargetKeys.add(targetKey);
    }
  }

  const missing = [...expected.keys()].filter((key) => !storedKeys.has(key));
  const missingSet = new Set(missing);
  // Only missing relocation targets need to be generated during repair.
  // The broader set also contains keys whose existing stale row will already
  // be replaced, so exposing it as the repair target list is unsafe.
  const relocatedMissingTargetKeys = [...relocatedTargetKeys].filter((key) =>
    missingSet.has(key)
  );
  const relocatedMissingTargets = relocatedMissingTargetKeys.map((key) => {
    const separator = key.indexOf("|");
    if (separator < 1) throw new Error(`Invalid repair key: ${key}`);
    return {
      asset: key.slice(0, separator),
      date: key.slice(separator + 1),
      expectedPulseIds: sorted(expected.get(key) ?? []),
    };
  });
  const manifest = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    dbPath: path.resolve(dbPath),
    dbFileSha256,
    pulseFilesSha256: pulseFileDigest.digest("hex"),
    counts: {
      pulses: pulses.length,
      invalidPulses: invalidPulseIds.length,
      duplicatePulseIds: duplicatePulseIds.size,
      expectedKeys: expected.size,
      storedRows: rows.length,
      correct,
      stale: affected.filter((row) => row.classification === "stale").length,
      orphan: affected.filter((row) => row.classification === "orphan").length,
      missing: missing.length,
      relocatedTargets: relocatedTargetKeys.size,
      relocatedMissingTargets: relocatedMissingTargetKeys.length,
    },
    invalidPulseIds: sorted(invalidPulseIds),
    duplicatePulseIds: sorted([...duplicatePulseIds]),
    pulseSnapshotSha256,
    affected: affected.sort(
      (a, b) => a.date.localeCompare(b.date) || a.asset.localeCompare(b.asset)
    ),
    allRelocatedTargetKeys: [...relocatedTargetKeys].sort(),
    relocatedMissingTargetKeys: relocatedMissingTargetKeys.sort(),
    relocatedMissingTargets: relocatedMissingTargets.sort(
      (a, b) => a.date.localeCompare(b.date) || a.asset.localeCompare(b.asset)
    ),
    missingKeys: missing.sort(),
  };

  console.log(JSON.stringify(manifest.counts, null, 2));
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const tempFile = `${outFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.renameSync(tempFile, outFile);
    console.log(`Manifest: ${outFile}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
