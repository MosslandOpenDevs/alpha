#!/usr/bin/env bash
#
# Long-lived wrapper that runs scripts/deploy.sh on a fixed cadence.
#
# Exists because pm2's `cron_restart` cannot drive a job that must not be
# interrupted: it restarts the process on schedule regardless of state
# (SIGINT, SIGKILL 1.6s later), which would kill a deploy mid-build and skip
# bash's EXIT trap. This loop sleeps between ticks instead — a tick that runs
# long delays the next one rather than being killed by it.
#
# On SIGTERM (pm2 stop/restart) it finishes the current tick if one is running
# and then exits, so `pm2 restart alpha-deploy` never lands in the middle of a
# swap.
set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
INTERVAL=${DEPLOY_INTERVAL_SEC:-300}
STOP=0
trap 'STOP=1' TERM INT

while :; do
  bash "${SCRIPT_DIR}/deploy.sh" || true
  [ "${STOP}" = "1" ] && exit 0
  # sleep in short slices so a stop request is honoured within seconds
  slept=0
  while [ "${slept}" -lt "${INTERVAL}" ]; do
    sleep 5; slept=$((slept + 5))
    [ "${STOP}" = "1" ] && exit 0
  done
done
