#!/usr/bin/env bash
# The CI jobs, runnable on a laptop. .github/workflows/ci.yml calls this same
# script for every job, so a local run and a CI run execute the same commands.
#
#   scripts/ci-local.sh              # every job in JOBS, in order
#   scripts/ci-local.sh mobile lint  # only these jobs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOBS=(lint mobile)

# The workflow files (actionlint) and this script (bash -n).
job_lint() {
  bash -n "$ROOT/scripts/ci-local.sh"
  (cd "$ROOT" && uvx --from actionlint-py==1.7.12.25 actionlint)
}

# CI starts from an empty runner and always runs `npm ci`. Locally the job keeps
# a working node_modules (a running Metro uses it) unless it is missing or
# CI_LOCAL_FRESH=1 is set.
job_mobile() {
  cd "$ROOT/apps/mobile"
  if [[ -n "${CI:-}" || "${CI_LOCAL_FRESH:-0}" == "1" || ! -d node_modules ]]; then
    npm ci --no-audit --no-fund
  fi
  npm run typecheck
  npm run test:coverage
  npm run depcruise
}

main() {
  local selected=("$@")
  if [[ ${#selected[@]} -eq 0 ]]; then
    selected=("${JOBS[@]}")
  fi
  local job
  for job in "${selected[@]}"; do
    if [[ " ${JOBS[*]} " != *" $job "* ]]; then
      echo "ci-local: unknown job '$job' (jobs: ${JOBS[*]})" >&2
      return 2
    fi
  done
  for job in "${selected[@]}"; do
    echo "==> $job"
    ("job_$job")
  done
  echo "ci-local: passed: ${selected[*]}"
}

main "$@"
