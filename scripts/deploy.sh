#!/usr/bin/env bash
#
# Alpha pull-based auto-deploy — release-worktree edition.
#
# Runs ON the application server from PM2's cron every few minutes and brings
# production up to origin/main. Idempotent: when the live release already
# matches the remote tip it exits 0 without touching anything.
#
# Modelled on the deploy.sh that agentic-orchestrator, Algora and media-kr
# already run on this box (pull-based because the box is Tailscale-only —
# nothing outside the tailnet can push to it), but adapted to how alpha is
# laid out: NOT an in-place `git reset --hard`. Alpha keeps one directory per
# release under ~/releases/ and PM2 points at whichever is live. That gives
# three properties the in-place model has to work for:
#
#   1. The build is atomic. `pnpm build` runs in a fresh directory; the live
#      release is not touched until the new one has built AND passed its
#      checks. A failed build leaves nothing to clean up.
#   2. Rollback is a pointer flip. The previous release stays on disk with its
#      node_modules and .next intact; recovering is `pm2 delete` + `pm2 start`
#      from that directory. No rebuild, no git surgery.
#   3. The repo checkout (~/alpha) is only an object store. Nothing here ever
#      resets it, so operator work in progress there is never at risk.
#
# Deploy state is the SHA of the last SUCCESSFUL deploy, written only after
# the health check passes — never the git HEAD, which moves before anything
# is proven. What PM2 is actually serving is the ground truth: if it already
# matches origin/main (say, an operator deployed by hand) that is adopted as
# the state, not redeployed. Repeated failures of the same SHA back off
# exponentially, and a SHA that failed AFTER the swap (rollback happened) is
# not retried at all until a new commit lands or --force is given — a
# post-swap failure means the code is bad, not the box, and rebuilding it
# every hour would only re-run the outage.
#
# Operator hold: `touch ~/alpha/.git/alpha-deploy-hold` stops the poller from
# deploying anything (it logs and exits each tick). Do this BEFORE rolling
# back by hand with pm2, or the poller will put main back within a tick.
#
# The body runs from main(), invoked on the last line, so this file can
# update itself mid-run: bash reads scripts incrementally, and without the
# wrapper an in-place update would have it continue at a byte offset of the
# NEW file.
#
# Usage:
#   scripts/deploy.sh            # deploy if the remote moved (cron use)
#   scripts/deploy.sh --check    # say what would happen, change nothing
#   scripts/deploy.sh --force    # ignore CI gate + failure backoff
#
# Configuration (env, all optional):
#   ALPHA_REPO             object-store checkout          (~/alpha)
#   ALPHA_RELEASES         release directories             (~/releases)
#   ALPHA_ENV_FILE         .env.local to copy into releases
#                          (default: the currently live release's)
#   DEPLOY_BRANCH / DEPLOY_REMOTE                          (main / origin)
#   DEPLOY_REQUIRE_CI      1 = deploy only CI-green commits   (default 1)
#   DEPLOY_GITHUB_REPO     owner/name for the CI query
#   DEPLOY_HEALTH_URL      liveness probe        (http://127.0.0.1:6900/api/health)
#   DEPLOY_STRICT_URL      subsystem probe       (…/api/health?strict=1)
#   DEPLOY_HEALTH_RETRIES / DEPLOY_HEALTH_INTERVAL         (20 / 3)
#   DEPLOY_KEEP_RELEASES   old releases to keep on disk    (default 4)
#   DEPLOY_KEEP_BACKUPS    pre-swap DB/pm2 backups to keep (default 10)
#   DEPLOY_QUIET_HOURS_KST hours (KST) in which to defer the deploy entirely
#                          (default "6 7 8 9 12 13" — the cron slots; a swap
#                          re-registers every cron and pm2 runs each once).
#                          Set to an empty string to disable.
#   DEPLOY_HOLD_FILE       operator hold — exists ⇒ do nothing
#   DEPLOY_CI_WAIT_MIN     how long to wait for a CI run to appear before
#                          deploying without one (default 15)
#   DEPLOY_ALERT_WEBHOOK   Slack/Discord webhook for failures
#   DEPLOY_VERBOSE         1 = log no-op ticks too
#   DEPLOY_RETRY_BASE_MIN / DEPLOY_RETRY_MAX_MIN           (5 / 60)
#   PM2_BIN / PNPM_BIN / GITHUB_TOKEN
#
# Data safety: this script never writes to DB_PATH or MIC_DATA_PATH. The only
# DB access is the read-only backup taken before each swap, and the smoke check
# which builds its own throwaway schema. .env.local is copied, never edited.

set -euo pipefail

# PM2 leaks the poller's own process config into the environment as plain
# variables and re-reads some of them from anything this script spawns —
# including the `pm2 start` below, which would inherit a cron_restart meant
# for the poller. Scrub first.
unset cron_restart autorestart watch instances exec_mode max_memory_restart \
      name script args interpreter 2>/dev/null || true

# The PM2 apps a release owns are whatever its ecosystem.config.cjs declares —
# read from the file, never listed here. A hand-kept copy drifted the first
# time the ecosystem gained an app: PR #13 added alpha-health-alert, the swap
# list did not know it, so `pm2 delete` skipped it and `pm2 start` saw an
# existing name and left it on the old release. Everything else on this box
# belongs to other projects and must never be touched by this script.
#
# `alpha-deploy` (this poller) is deliberately not in any release's ecosystem.
# It is registered once from ~/alpha's ecosystem.deploy.config.cjs — the
# object-store checkout, which the ff-only step keeps current — so it never
# needs re-registering and never deletes the process it is running in.
release_apps() {
  local dir="$1"
  ( cd "${dir}" && node -e '
const apps = require("./ecosystem.config.cjs").apps || [];
process.stdout.write(apps.map(a => a.name).filter(Boolean).join(" "));
' 2>/dev/null )
}

log() {
  local line
  line="[deploy $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
  echo "${line}"
  mkdir -p "$(dirname "${DEPLOY_LOG}")" 2>/dev/null || true
  echo "${line}" >>"${DEPLOY_LOG}" 2>/dev/null || true
}

json_string() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1" 2>/dev/null \
    || printf '"%s"' "$(printf '%s' "$1" | tr -d '"\\')"
}

alert() {
  # Never silent: an alert with nowhere to go is still worth a log line, or
  # the operator believes the channel is wired when it is not.
  [ -n "${DEPLOY_ALERT_WEBHOOK}" ] || { log "NOTE alert not sent (no webhook configured): $1"; return 0; }
  curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":$(json_string "$1"),\"content\":$(json_string "$1")}" \
    "${DEPLOY_ALERT_WEBHOOK}" >/dev/null 2>&1 || true
}

acquire_lock() {
  mkdir -p "$(dirname "${DEPLOY_LOCK}")"
  if mkdir "${DEPLOY_LOCK}" 2>/dev/null; then
    printf '%s\n' "$$" >"${DEPLOY_LOCK}/pid" 2>/dev/null || true
    return 0
  fi
  local owner
  owner=$(cat "${DEPLOY_LOCK}/pid" 2>/dev/null || true)
  case "${owner}" in *[!0-9]*|'') owner="" ;; esac
  if [ -n "${owner}" ] && ! kill -0 "${owner}" 2>/dev/null; then
    log "WARN lock owner (pid ${owner}) is gone -- reclaiming"
    rm -rf "${DEPLOY_LOCK}"
  elif [ -n "$(find "${DEPLOY_LOCK}" -maxdepth 0 -mmin "+${DEPLOY_LOCK_STALE_MIN}" 2>/dev/null)" ]; then
    log "WARN lock older than ${DEPLOY_LOCK_STALE_MIN}m -- reclaiming"
    rm -rf "${DEPLOY_LOCK}"
  else
    [ "${DEPLOY_VERBOSE}" = "1" ] && log "another deploy is running -- skipping"
    return 1
  fi
  if mkdir "${DEPLOY_LOCK}" 2>/dev/null; then
    printf '%s\n' "$$" >"${DEPLOY_LOCK}/pid" 2>/dev/null || true
    return 0
  fi
  log "could not reclaim lock; skipping"
  return 1
}

# GitHub check-runs verdict for a SHA: success | failure | pending | none |
# unknown. Fetch and parse are two steps on purpose: a pipeline under pipefail
# printed two verdicts on failure and blocked forever.
#
# "unknown" (API unreachable) passes — the box must not be unable to deploy
# because GitHub is down. "none" does NOT pass here, unlike the sibling
# scripts on this box: this repo has CI, so an empty check-run list means the
# run has not been created yet, not that there is nothing to wait for. That is
# exactly what happened on 2026-08-18: the poller ticked at 08:59:00, the CI
# run for that merge was created at 08:59:01, and the deploy went out one
# second ahead of its own gate. Set DEPLOY_REQUIRE_CI=0 for a repo without CI.
ci_conclusion() {
  local sha="$1" url auth body code
  url="https://api.github.com/repos/${DEPLOY_GITHUB_REPO}/commits/${sha}/check-runs"
  if [ -n "${GITHUB_TOKEN:-}" ]; then auth="Authorization: Bearer ${GITHUB_TOKEN}"
  else auth="X-No-Auth: 1"; fi
  # No -f: a 401 (revoked token), 403/429 (rate limit) or 404 (wrong repo)
  # must be told apart from "GitHub is down". All of them still pass the gate
  # (below), but the operator gets the status code instead of "unknown".
  body=$(curl -sS -m 20 -w '\n%{http_code}' -H 'Accept: application/vnd.github+json' -H "${auth}" "${url}" 2>/dev/null) \
    || { echo "unknown"; return 0; }
  code=${body##*$'\n'}
  body=${body%$'\n'*}
  case "${code}" in
    2*) ;;
    *) echo "error:${code}"; return 0 ;;
  esac
  printf '%s' "${body}" | python3 -c '
import json, sys
try:
    runs = json.load(sys.stdin).get("check_runs", [])
except Exception:
    print("unknown"); raise SystemExit
if not runs:
    print("none"); raise SystemExit
bad = {"failure", "cancelled", "timed_out", "action_required", "startup_failure"}
if any(r.get("status") != "completed" for r in runs): print("pending")
elif any(r.get("conclusion") in bad for r in runs): print("failure")
else: print("success")
' 2>/dev/null || echo "unknown"
}

# The directory PM2 is actually serving alpha-web from — the ground truth for
# "what is live", independent of any state file.
live_release_dir() {
  "${PM2_BIN}" jlist 2>/dev/null | python3 -c '
import json, sys
# pm2 prints a version-mismatch banner on the same stdout as the JSON when the
# CLI and daemon differ; start parsing at the first "[".
raw = sys.stdin.read()
try:
    apps = json.loads(raw[raw.find("["):])
except Exception:
    raise SystemExit
for a in apps:
    if a.get("name") == "alpha-web":
        print((a.get("pm2_env") or {}).get("pm_cwd") or "")
        break
' 2>/dev/null || true
}

health_ok() {
  local i=0 code
  while [ "${i}" -lt "${DEPLOY_HEALTH_RETRIES}" ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "${DEPLOY_HEALTH_URL}" 2>/dev/null || echo 000)
    case "${code}" in 2*) return 0 ;; esac
    i=$((i + 1))
    sleep "${DEPLOY_HEALTH_INTERVAL}"
  done
  log "liveness never passed (last code ${code})"
  return 1
}

# The strict probe answers 503 when a subsystem is `fail`. Alert-only: most
# subsystem failures (SignalMap canonical stale, a cron that has not run yet
# after the swap) are not caused by this deploy and cannot be fixed by
# rolling it back — the previous release reads the same DB and data dir.
strict_ok() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "${DEPLOY_STRICT_URL}" 2>/dev/null || echo 000)
  case "${code}" in
    200) return 0 ;;
    404) log "NOTE strict probe is 404 -- build predates ?strict=1, skipping"; return 0 ;;
  esac
  log "WARN ${DEPLOY_STRICT_URL} returned ${code} -- serving, but a subsystem reports fail"
  log "     see ${DEPLOY_HEALTH_URL}?detail=1"
  alert "alpha: ${TARGET:0:8} deployed but /api/health?strict=1 is ${code}"
  return 1
}

# Register the 13 alpha apps from a release directory. `pm2 delete` first:
# `pm2 start ecosystem.config.cjs` on already-registered names would keep the
# OLD cwd/script path and only restart. Only the release's own apps are
# touched — never the poller, never another project's.
# App names touched by the previous pm2_swap_to in THIS run. A rollback calls
# pm2_swap_to(LIVE_DIR) after pm2_swap_to(NEW_DIR); its union is then OLD ∪ OLD,
# so an app that only the NEW release declared stayed registered — pointing at
# the directory discard_release removes seconds later, and persisted by
# `pm2 save`. Carrying the forward swap's set into the rollback closes that.
SWAP_APPS=""

pm2_swap_to() {
  local dir="$1" app apps
  # Delete the union of what the OLD release declared and what the NEW one
  # declares: an app dropped from the ecosystem must not linger on the old
  # release, and an app added must not be skipped.
  apps="$(release_apps "${dir}") $(release_apps "${LIVE_DIR:-}") ${SWAP_APPS}"
  if [ -z "$(echo "${apps}" | tr -d '[:space:]')" ]; then
    log "ERROR could not read app names from ${dir}/ecosystem.config.cjs"; return 1
  fi
  SWAP_APPS="${apps}"
  for app in $(echo "${apps}" | tr ' ' '\n' | sort -u); do
    case "${app}" in
      alpha-deploy) continue ;;                          # never touch the poller
      alpha-*) "${PM2_BIN}" delete "${app}" >/dev/null 2>&1 || true ;;
      *) log "WARN ecosystem declares non-alpha app '${app}' -- refusing to touch it" ;;
    esac
  done
  # pm2 merges the caller's process.env into each app's stored env. Do not
  # let the poller's GITHUB_TOKEN / DEPLOY_* leak into the 13 apps.
  ( cd "${dir}" && env -u GITHUB_TOKEN -u DEPLOY_ALERT_WEBHOOK -u DEPLOY_REQUIRE_CI \
        -u DEPLOY_INTERVAL_SEC "${PM2_BIN}" start ecosystem.config.cjs >/dev/null 2>&1 ) \
    || { log "ERROR pm2 start from ${dir} failed"; return 1; }
  "${PM2_BIN}" save >/dev/null 2>&1 || log "WARN pm2 save failed"
}

backup_before_swap() {
  local ts dir
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "${DEPLOY_BACKUP_DIR}"
  cp "${HOME}/.pm2/dump.pm2" "${DEPLOY_BACKUP_DIR}/dump.pm2-before-${ts}" 2>/dev/null || true
  # No sqlite3 CLI on the box; use the release's better-sqlite3 for a
  # WAL-consistent snapshot. Read-only handle.
  dir="$1"
  ( cd "${dir}" && DB_PATH="${DB_PATH:-}" node -e '
const fs = require("fs"); const path = require("path");
const env = fs.readFileSync(".env.local", "utf8");
const m = env.match(/^DB_PATH=(.+)$/m); const src = process.env.DB_PATH || (m && m[1].trim());
if (!src) { console.error("no DB_PATH"); process.exit(1); }
const out = path.join(process.argv[1], "moss_land-before-" + process.argv[2] + ".sqlite");
const D = require("better-sqlite3"); const db = new D(src, { readonly: true });
db.backup(out).then(() => { db.close(); }).catch((e) => { console.error(e.message); process.exit(1); });
' "${DEPLOY_BACKUP_DIR}" "${ts}" ) || { log "ERROR DB backup failed -- not swapping"; return 1; }
  log "backed up DB and pm2 dump to ${DEPLOY_BACKUP_DIR} (${ts})"
  # Retention. Every swap adds a full DB copy; unbounded, that fills the disk
  # the app and the next build both need. Retention must never veto the swap:
  # under pipefail an `ls` over an empty glob returns non-zero, and as the
  # last command of this function that failed the whole deploy as "pre-swap
  # backup" on a host with no dump.pm2 yet — after the DB backup succeeded.
  ls -1t "${DEPLOY_BACKUP_DIR}"/moss_land-before-*.sqlite 2>/dev/null | tail -n "+$((DEPLOY_KEEP_BACKUPS + 1))" | xargs -r rm -f || true
  ls -1t "${DEPLOY_BACKUP_DIR}"/dump.pm2-before-* 2>/dev/null | tail -n "+$((DEPLOY_KEEP_BACKUPS + 1))" | xargs -r rm -f || true
  return 0
}

# Remove a release directory that will never be live. Called on every failure
# path so a bad SHA cannot fill the disk or crowd the rollback pool.
discard_release() {
  local d="$1"
  [ -n "${d}" ] && [ -d "${d}" ] || return 0
  ( cd "${ALPHA_REPO}" && git worktree remove --force "${d}" >/dev/null 2>&1 ) || rm -rf "${d}"
}

# Keep the N most recent release dirs plus whatever is live. Old ones are the
# rollback path, but they are 30–40MB each and accumulate forever otherwise.
prune_releases() {
  local live="$1" keep="${DEPLOY_KEEP_RELEASES}" d n=0
  # newest first by mtime; skip live; delete past `keep`
  while IFS= read -r d; do
    [ -n "${d}" ] || continue
    [ "${d}" = "${live}" ] && continue
    # A directory without a finished build is not a rollback candidate; it is
    # debris (interrupted install/build). Remove it outright rather than let it
    # occupy a keep slot.
    if [ ! -f "${d}/.next/BUILD_ID" ]; then log "prune (incomplete) ${d}"; discard_release "${d}"; continue; fi
    n=$((n + 1))
    if [ "${n}" -gt "${keep}" ]; then
      log "prune ${d}"
      ( cd "${ALPHA_REPO}" && git worktree remove --force "${d}" >/dev/null 2>&1 ) || rm -rf "${d}"
    fi
  done < <(ls -1dt "${ALPHA_RELEASES}"/alpha-* 2>/dev/null || true)
  ( cd "${ALPHA_REPO}" && git worktree prune >/dev/null 2>&1 ) || true
}

record_success() { printf '%s\n' "$1" >"${DEPLOY_STATE_FILE}" 2>/dev/null || true; rm -f "${DEPLOY_ATTEMPT_FILE}" 2>/dev/null || true; }

# Attempt file: "<sha> <count> <epoch> <phase>". phase is "build" (failed
# before touching production) or "swap" (production was touched and rolled
# back). A swap-phase failure blocks that SHA outright.
backoff_blocks() {
  local target="$1" prev_sha prev_n prev_at prev_phase now wait_min
  [ -f "${DEPLOY_ATTEMPT_FILE}" ] || return 1
  read -r prev_sha prev_n prev_at prev_phase <"${DEPLOY_ATTEMPT_FILE}" 2>/dev/null || return 1
  [ "${prev_sha}" = "${target}" ] || return 1
  if [ "${prev_phase:-}" = "swap" ]; then
    [ "${DEPLOY_VERBOSE}" = "1" ] && log "holding ${target:0:8}: it failed after the swap and was rolled back; needs a new commit or --force"
    return 0
  fi
  case "${prev_n}${prev_at}" in *[!0-9]*) return 1 ;; esac
  [ "${prev_n}" -ge 1 ] || return 1
  wait_min=$((DEPLOY_RETRY_BASE_MIN * (1 << (prev_n > 5 ? 5 : prev_n - 1))))
  [ "${wait_min}" -gt "${DEPLOY_RETRY_MAX_MIN}" ] && wait_min=${DEPLOY_RETRY_MAX_MIN}
  now=$(date +%s)
  if [ $((now - prev_at)) -lt $((wait_min * 60)) ]; then
    [ "${DEPLOY_VERBOSE}" = "1" ] && log "backing off ${target:0:8} (${prev_n} failures, ${wait_min}m)"
    return 0
  fi
  return 1
}

record_failure() {
  local target="$1" phase="${2:-build}" prev_sha prev_n prev_phase n=1
  if [ -f "${DEPLOY_ATTEMPT_FILE}" ]; then
    read -r prev_sha prev_n _ prev_phase <"${DEPLOY_ATTEMPT_FILE}" 2>/dev/null || true
    if [ "${prev_sha:-}" = "${target}" ]; then
      case "${prev_n:-}" in ''|*[!0-9]*) prev_n=0 ;; esac
      n=$((prev_n + 1))
      # never downgrade swap → build
      [ "${prev_phase:-}" = "swap" ] && phase="swap"
    fi
  fi
  printf '%s %s %s %s\n' "${target}" "${n}" "$(date +%s)" "${phase}" >"${DEPLOY_ATTEMPT_FILE}" 2>/dev/null || true
}

# Has "no CI run yet" persisted for TARGET longer than DEPLOY_CI_WAIT_MIN?
# First sighting is stamped in a small file keyed by SHA; a new SHA resets it.
ci_wait_expired() {
  local target="$1" f="${DEPLOY_CI_WAIT_FILE}" seen_sha seen_at now
  now=$(date +%s)
  if [ -f "${f}" ]; then
    read -r seen_sha seen_at <"${f}" 2>/dev/null || true
    if [ "${seen_sha:-}" = "${target}" ] && [ -n "${seen_at:-}" ] && [ "${seen_at}" -eq "${seen_at}" ] 2>/dev/null; then
      [ $((now - seen_at)) -ge $((DEPLOY_CI_WAIT_MIN * 60)) ] && return 0
      return 1
    fi
  fi
  printf '%s %s\n' "${target}" "${now}" >"${f}" 2>/dev/null || true
  return 1
}

# KST hour (0-23) — the cron slots are defined in KST in ecosystem.config.cjs.
kst_hour() { TZ=Asia/Seoul date +%-H; }

in_quiet_hours() {
  local h hh
  h=$(kst_hour)
  for hh in ${DEPLOY_QUIET_HOURS_KST}; do [ "${h}" = "${hh}" ] && return 0; done
  return 1
}

rollback_to() {
  local dir="$1"
  if [ ! -d "${dir}" ] || [ ! -f "${dir}/.next/BUILD_ID" ]; then
    log "CRITICAL rollback target ${dir} is missing or unbuilt -- manual intervention needed"
    alert "alpha CRITICAL: deploy of ${TARGET:0:8} failed and the previous release ${dir} is gone"
    return 1
  fi
  log "ROLLBACK -> ${dir}"
  if pm2_swap_to "${dir}" && health_ok; then
    log "rollback healthy"
    alert "alpha: deploy of ${TARGET:0:8} failed; rolled back to $(basename "${dir}") (healthy)"
    return 0
  fi
  log "CRITICAL rollback did not come back healthy -- manual intervention needed"
  alert "alpha CRITICAL: deploy of ${TARGET:0:8} failed AND rollback to $(basename "${dir}") is unhealthy"
  return 1
}

main() {
  ALPHA_REPO=${ALPHA_REPO:-${HOME}/alpha}
  ALPHA_RELEASES=${ALPHA_RELEASES:-${HOME}/releases}
  DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}
  DEPLOY_REMOTE=${DEPLOY_REMOTE:-origin}
  DEPLOY_REQUIRE_CI=${DEPLOY_REQUIRE_CI:-1}
  DEPLOY_GITHUB_REPO=${DEPLOY_GITHUB_REPO:-MosslandOpenDevs/alpha}
  DEPLOY_HEALTH_URL=${DEPLOY_HEALTH_URL:-http://127.0.0.1:${PORT:-6900}/api/health}
  DEPLOY_STRICT_URL=${DEPLOY_STRICT_URL:-${DEPLOY_HEALTH_URL}?strict=1}
  DEPLOY_HEALTH_RETRIES=${DEPLOY_HEALTH_RETRIES:-20}
  DEPLOY_HEALTH_INTERVAL=${DEPLOY_HEALTH_INTERVAL:-3}
  DEPLOY_KEEP_RELEASES=${DEPLOY_KEEP_RELEASES:-4}
  DEPLOY_KEEP_BACKUPS=${DEPLOY_KEEP_BACKUPS:-10}
  # `-` not `:-`: unset takes the default, but an explicit empty string means
  # "no quiet hours". With `:-` the empty value was silently replaced by the
  # default and the guard could not be turned off.
  DEPLOY_QUIET_HOURS_KST=${DEPLOY_QUIET_HOURS_KST-"6 7 8 9 12 13"}
  # The webhook is a credential and this repo is public, so it lives only in
  # a server-side .env.local (gitignored). The TS scripts read the LIVE
  # RELEASE's copy; that is preferred once LIVE_DIR is known (below, in
  # main). This early read of the object-store checkout's copy is only the
  # fallback for the path where LIVE_DIR cannot be determined at all. A value
  # given explicitly in the environment always wins over both files.
  DEPLOY_ALERT_WEBHOOK_EXPLICIT=${DEPLOY_ALERT_WEBHOOK:-}
  if [ -z "${DEPLOY_ALERT_WEBHOOK:-}" ] && [ -f "${LIVE_ENV_HINT:-${ALPHA_REPO}/.env.local}" ]; then
    DEPLOY_ALERT_WEBHOOK=$(sed -n 's/^ALERT_WEBHOOK_URL=//p' "${LIVE_ENV_HINT:-${ALPHA_REPO}/.env.local}" | head -1)
  fi
  DEPLOY_ALERT_WEBHOOK=${DEPLOY_ALERT_WEBHOOK:-}
  DEPLOY_VERBOSE=${DEPLOY_VERBOSE:-0}
  DEPLOY_LOG=${DEPLOY_LOG:-${HOME}/logs/alpha-deploy.log}
  DEPLOY_LOCK=${DEPLOY_LOCK:-${HOME}/logs/.alpha-deploy.lock}
  DEPLOY_LOCK_STALE_MIN=${DEPLOY_LOCK_STALE_MIN:-90}
  DEPLOY_BACKUP_DIR=${DEPLOY_BACKUP_DIR:-${HOME}/backups/alpha}
  DEPLOY_RETRY_BASE_MIN=${DEPLOY_RETRY_BASE_MIN:-5}
  DEPLOY_RETRY_MAX_MIN=${DEPLOY_RETRY_MAX_MIN:-60}
  PM2_BIN=${PM2_BIN:-pm2}
  PNPM_BIN=${PNPM_BIN:-pnpm}

  # State lives inside the object-store's .git — nothing builds or resets there.
  GIT_DIR_ABS=$(cd "${ALPHA_REPO}" && git rev-parse --absolute-git-dir 2>/dev/null || echo "${ALPHA_REPO}/.git")
  DEPLOY_STATE_FILE=${DEPLOY_STATE_FILE:-${GIT_DIR_ABS}/alpha-deployed-sha}
  DEPLOY_ATTEMPT_FILE=${DEPLOY_ATTEMPT_FILE:-${GIT_DIR_ABS}/alpha-deploy-attempt}
  DEPLOY_HOLD_FILE=${DEPLOY_HOLD_FILE:-${GIT_DIR_ABS}/alpha-deploy-hold}
  DEPLOY_CI_WAIT_FILE=${DEPLOY_CI_WAIT_FILE:-${GIT_DIR_ABS}/alpha-deploy-ci-wait}
  DEPLOY_CI_WAIT_MIN=${DEPLOY_CI_WAIT_MIN:-15}

  FORCE=0; CHECK_ONLY=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) FORCE=1 ;;
      --check) CHECK_ONLY=1 ;;
      -h|--help) sed -n '2,60p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) echo "unknown option: $1" >&2; exit 64 ;;
    esac
    shift
  done

  acquire_lock || exit 0
  trap 'rm -rf "${DEPLOY_LOCK}" 2>/dev/null || true' EXIT

  if [ -f "${DEPLOY_HOLD_FILE}" ] && [ "${FORCE}" != "1" ]; then
    log "HOLD: ${DEPLOY_HOLD_FILE} exists -- not deploying (rm it to resume)"
    exit 0
  fi

  # --- 1. Anything to deploy? ----------------------------------------------
  ( cd "${ALPHA_REPO}" && git fetch --quiet "${DEPLOY_REMOTE}" "${DEPLOY_BRANCH}" ) || {
    log "WARN git fetch failed -- will retry next tick"; exit 0
  }
  TARGET=$(cd "${ALPHA_REPO}" && git rev-parse "${DEPLOY_REMOTE}/${DEPLOY_BRANCH}")

  # Read what is live BEFORE fast-forwarding the checkout below. On a host
  # bootstrapped the README way, alpha-web runs from ${ALPHA_REPO} itself; if
  # the ff-only ran first it moved that HEAD to the tip, LIVE_SHA equalled
  # TARGET, and every new commit was "adopted" as deployed without a build.
  LIVE_DIR=$(live_release_dir)
  if [ -z "${LIVE_DIR}" ] || [ ! -d "${LIVE_DIR}" ]; then
    log "ERROR cannot determine the live release from pm2 (alpha-web missing?) -- refusing to run"
    # This is what a swap interrupted between pm2 delete and pm2 start looks
    # like: nothing serving on 6900 and a poller that refuses to touch it.
    # Say so somewhere a person will see it.
    alert "alpha CRITICAL: alpha-web is not registered in pm2 -- site likely down; poller refusing to run"
    exit 1
  fi
  LIVE_SHA=$(cd "${LIVE_DIR}" && git rev-parse HEAD 2>/dev/null || echo "")
  # Prefer the live release's webhook — the same file health-alert.ts and the
  # other TS scripts read — over the object-store checkout's.
  if [ -z "${DEPLOY_ALERT_WEBHOOK_EXPLICIT:-}" ] && [ -f "${LIVE_DIR}/.env.local" ]; then
    _hook=$(sed -n 's/^ALERT_WEBHOOK_URL=//p' "${LIVE_DIR}/.env.local" | head -1)
    [ -n "${_hook}" ] && DEPLOY_ALERT_WEBHOOK="${_hook}"
  fi

  # Keep the object-store checkout on the tip too. This is what PM2 runs the
  # poller from, so this fast-forward is how deploy.sh updates itself; the
  # main() wrapper makes that safe mid-run. Fast-forward only — if someone
  # has local commits or edits there, leave them and keep deploying releases.
  if ! ( cd "${ALPHA_REPO}" \
      && [ -z "$(git status --porcelain)" ] \
      && git merge --ff-only --quiet "${DEPLOY_REMOTE}/${DEPLOY_BRANCH}" >/dev/null 2>&1 ); then
    # Always logged: while this holds, deploy.sh itself is not being updated.
    log "NOTE ${ALPHA_REPO} not fast-forwarded (dirty, untracked collision, or diverged) -- poller script may be stale; releases unaffected"
  fi

  DEPLOYED=$(cat "${DEPLOY_STATE_FILE}" 2>/dev/null || true)
  if [ -z "${DEPLOYED}" ] || ! ( cd "${ALPHA_REPO}" && git cat-file -e "${DEPLOYED}^{commit}" 2>/dev/null ); then
    [ -n "${DEPLOYED}" ] && log "WARN state SHA (${DEPLOYED:0:8}) unknown -- assuming live release was deployed"
    DEPLOYED=${LIVE_SHA}
    printf '%s\n' "${DEPLOYED}" >"${DEPLOY_STATE_FILE}" || {
      log "ERROR cannot write ${DEPLOY_STATE_FILE} -- refusing to run without retry protection"; exit 1
    }
  fi

  # What PM2 serves is the truth. If it is already the tip — however it got
  # there, including a hand deploy — adopt it and stop. Rebuilding the same
  # SHA would only restart 13 apps for nothing.
  if [ "${LIVE_SHA}" = "${TARGET}" ]; then
    [ "${DEPLOYED}" = "${TARGET}" ] || { log "live already at ${TARGET:0:8}; adopting as deployed state"; record_success "${TARGET}"; }
    { [ "${DEPLOY_VERBOSE}" = "1" ] || [ "${CHECK_ONLY}" = "1" ]; } && log "up to date at ${TARGET:0:8} (${LIVE_DIR})"
    exit 0
  fi

  # State says the tip was deployed but PM2 is on something else: an operator
  # rolled back by hand. Do NOT undo that — say so and stop until told otherwise.
  if [ "${DEPLOYED}" = "${TARGET}" ] && [ "${FORCE}" != "1" ]; then
    log "WARN state says ${TARGET:0:8} is deployed but pm2 serves ${LIVE_SHA:0:8} (${LIVE_DIR}) -- looks like a manual rollback; not redeploying. touch ${DEPLOY_HOLD_FILE} to silence, or --force / a new commit to proceed"
    alert "alpha: manual rollback detected (${LIVE_SHA:0:8} live, ${TARGET:0:8} on main); auto-deploy paused for this SHA"
    exit 0
  fi

  # --- 2. Guards -----------------------------------------------------------
  if [ "${FORCE}" != "1" ]; then
    if backoff_blocks "${TARGET}"; then exit 0; fi
    if [ "${DEPLOY_REQUIRE_CI}" = "1" ]; then
      CI=$(ci_conclusion "${TARGET}" | tail -n 1 | tr -d '[:space:]')
      case "${CI}" in
        success) ;;
        # Fail-open by design (see ci_conclusion) — but never silently. This
        # used to share the `success` branch and print nothing, so a revoked
        # token turned the gate off with no trace in the log.
        unknown|error:*)
          log "WARN no CI verdict for ${TARGET:0:8} (${CI}) -- GitHub API unreachable or rejected the request; deploying without one"
          alert "alpha: deploying ${TARGET:0:8} WITHOUT a CI verdict (${CI})" ;;
        # "none" = the run does not exist yet (see ci_conclusion). Wait a tick —
        # but not forever: if Actions is disabled or the workflow file is broken
        # no run will ever appear, and a poller stuck on that is a silent
        # outage of its own. After DEPLOY_CI_WAIT_MIN with still no run, warn
        # loudly and go ahead, the way a repo without CI would.
        none)
          if ci_wait_expired "${TARGET}"; then
            log "WARN no CI run appeared for ${TARGET:0:8} in ${DEPLOY_CI_WAIT_MIN}m -- Actions disabled or workflow broken? deploying without a CI verdict"
            alert "alpha: deploying ${TARGET:0:8} WITHOUT a CI verdict -- no check run appeared in ${DEPLOY_CI_WAIT_MIN}m"
          else
            log "CI run not created yet for ${TARGET:0:8} -- not deploying yet"; exit 0
          fi ;;
        pending) log "CI is pending for ${TARGET:0:8} -- not deploying yet"; exit 0 ;;
        failure) log "CI is ${CI} for ${TARGET:0:8} -- not deploying"; exit 0 ;;
        *) log "WARN unrecognised CI verdict '${CI}' -- treating as unknown" ;;
      esac
    fi
  fi

  if [ "${CHECK_ONLY}" = "1" ]; then
    log "would deploy ${DEPLOYED:0:8} -> ${TARGET:0:8}  (live: ${LIVE_DIR})$(in_quiet_hours && printf ' [quiet hour %s KST: would defer, not build]' "$(kst_hour)")"
    ( cd "${ALPHA_REPO}" && git --no-pager log --oneline "${DEPLOYED}..${TARGET}" 2>/dev/null | head -10 ) || true
    exit 0
  fi

  # --- 3. Build the new release in its own directory ------------------------
  # Quiet hours are checked BEFORE building, not after. A swap re-registers
  # every cron app and pm2 runs each one immediately, so inside a cron's own
  # KST hour that fires it a second time — hence the deferral. But the check
  # used to sit after the build, so every 5-minute tick during those hours
  # built the same commit and threw it away: eight full install+build+smoke
  # cycles for one deploy on 2026-08-19. The verdict does not depend on the
  # build, so ask first.
  if in_quiet_hours && [ "${FORCE}" != "1" ]; then
    log "${TARGET:0:8} is ready but it is $(kst_hour):xx KST (a cron slot) -- deferring to a later tick"
    exit 0
  fi

  ENV_SRC=${ALPHA_ENV_FILE:-${LIVE_DIR}/.env.local}
  if [ ! -f "${ENV_SRC}" ]; then
    log "ERROR ${ENV_SRC} not found -- a release without .env.local would start with no DB_PATH"
    record_failure "${TARGET}"; exit 1
  fi

  log "deploying ${DEPLOYED:0:8} -> ${TARGET:0:8}"
  NEW_DIR="${ALPHA_RELEASES}/alpha-${TARGET:0:7}-$(date -u +%Y%m%dT%H%M%SZ)"

  # Any failure before the swap: production untouched, remove the half-made
  # release, record it (phase "build" — retry with backoff is fine).
  fail_build() {
    log "ERROR $1 -- live release ${LIVE_DIR} left as is"
    record_failure "${TARGET}" build
    alert "alpha: deploy of ${TARGET:0:8} failed at '$1'; live release unchanged"
    discard_release "${NEW_DIR}"
    exit 1
  }

  ( cd "${ALPHA_REPO}" && git worktree add --detach "${NEW_DIR}" "${TARGET}" --quiet ) \
    || fail_build "git worktree add"
  cp "${ENV_SRC}" "${NEW_DIR}/.env.local" && chmod 600 "${NEW_DIR}/.env.local" \
    || fail_build "copy .env.local"

  ( cd "${NEW_DIR}" && "${PNPM_BIN}" install --frozen-lockfile >/dev/null 2>&1 ) || fail_build "pnpm install"
  ( cd "${NEW_DIR}" && "${PNPM_BIN}" build >/dev/null 2>&1 ) || fail_build "next build"

  # The one check tsc and next build cannot make: getSystemHealth()'s raw SQL
  # against the real schema. A column typo here would 500 every health surface.
  ( cd "${NEW_DIR}" && ./node_modules/.bin/tsx scripts/check-health.ts >/dev/null 2>&1 ) \
    || fail_build "check-health smoke test"

  # --- 4. Swap -------------------------------------------------------------
  backup_before_swap "${NEW_DIR}" || fail_build "pre-swap backup"

  # From here production is being touched. A failure is recorded as phase
  # "swap" — terminal for this SHA — BEFORE anything else, so a rollback that
  # itself fails cannot skip the bookkeeping under set -e.
  #
  # And from here a dropped SSH session (HUP) or a stray Ctrl-C must not stop
  # us: pm2_swap_to deletes 13 apps and then starts them, and dying between
  # the two leaves nothing serving and nothing that will restart it. Ignore
  # those signals for the few seconds the swap and any rollback take. SIGKILL
  # cannot be caught — pm2 stop's escalation is still a hazard for a MANUAL
  # run of this script under pm2, which is why the poller is a loop that
  # invokes this script rather than this script itself.
  trap '' HUP INT TERM
  if ! pm2_swap_to "${NEW_DIR}"; then
    record_failure "${TARGET}" swap
    rollback_to "${LIVE_DIR}" || true
    discard_release "${NEW_DIR}"
    exit 1
  fi

  if health_ok; then
    record_success "${TARGET}"
    log "deployed ${TARGET:0:8} at ${NEW_DIR}"
    strict_ok || true
    prune_releases "${NEW_DIR}"
    exit 0
  fi

  record_failure "${TARGET}" swap
  rollback_to "${LIVE_DIR}" || true
  discard_release "${NEW_DIR}"
  exit 1
}

main "$@"
