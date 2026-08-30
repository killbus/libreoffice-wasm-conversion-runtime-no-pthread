#!/usr/bin/env bash
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: retry-command.sh <command> [args...]" >&2
  exit 2
fi

attempts="${RETRY_ATTEMPTS:-8}"
delay="${RETRY_INITIAL_DELAY_SECONDS:-5}"
max_delay="${RETRY_MAX_DELAY_SECONDS:-60}"
attempt=1

while true; do
  "$@"
  status=$?
  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if [ "$attempt" -ge "$attempts" ]; then
    echo "[retry] command failed after ${attempt} attempts (exit ${status}): $*" >&2
    exit "$status"
  fi

  echo "[retry] transient failure ${attempt}/${attempts} (exit ${status}); retrying in ${delay}s: $*" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
  delay=$((delay * 2))
  if [ "$delay" -gt "$max_delay" ]; then
    delay="$max_delay"
  fi
done
