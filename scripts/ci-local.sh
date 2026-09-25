#!/usr/bin/env bash
# The CI jobs, runnable on a laptop. .github/workflows/ci.yml calls this same
# script for every job, so a local run and a CI run execute the same commands.
#
#   scripts/ci-local.sh              # every job in JOBS, in order
#   scripts/ci-local.sh mobile lint  # only these jobs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOBS=(lint mobile integration contract deploy)

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

# The Global Constraints test command, plus the coverage gate.
UV_TEST=(uv run --python 3.11 --with pytest --with pytest-cov --with pyyaml)

job_integration() {
  cd "$ROOT/integrations/ergates"
  "${UV_TEST[@]}" pytest --cov --cov-fail-under=90
}

HERMES_PIN="d76856cc6971b6e0e1903b5369498bcc4bb83a60"

# Fails unless $1 is a Hermes checkout at the pin without local changes.
check_pin() {
  local head
  head="$(git -C "$1" rev-parse HEAD)"
  if [[ "$head" != "$HERMES_PIN" ]]; then
    echo "ci-local: $1 is at $head, not the Hermes pin $HERMES_PIN" >&2
    return 1
  fi
  if ! git -C "$1" diff --quiet HEAD; then
    echo "ci-local: $1 has local changes; the contract tests need the pinned files as committed" >&2
    return 1
  fi
}

# Exports HERMES_SOURCE, a checkout at the pin:
#  - HERMES_SOURCE when set (CI checks the pin out there);
#  - else $ROOT/.cache/hermes-pin, created once as a detached `git worktree add`
#    from HERMES_REPO (default ~/Projects/misc/hermes/hermes-agent), or fetched
#    from GitHub when that clone does not have the pinned commit.
# The only write to an existing Hermes clone is that `git worktree add`.
prepare_hermes_source() {
  if [[ -n "${HERMES_SOURCE:-}" ]]; then
    check_pin "$HERMES_SOURCE"
    return
  fi
  local cache="$ROOT/.cache/hermes-pin"
  local repo="${HERMES_REPO:-$HOME/Projects/misc/hermes/hermes-agent}"
  if [[ ! -e "$cache" ]]; then
    mkdir -p "$ROOT/.cache"
    if git -C "$repo" cat-file -e "$HERMES_PIN^{commit}" 2>/dev/null; then
      git -C "$repo" worktree add --detach "$cache" "$HERMES_PIN"
    else
      git init -q "$cache"
      git -C "$cache" fetch -q --depth 1 https://github.com/NousResearch/hermes-agent "$HERMES_PIN"
      git -C "$cache" checkout -q --detach FETCH_HEAD
    fi
  fi
  check_pin "$cache"
  export HERMES_SOURCE="$cache"
}

job_contract() {
  prepare_hermes_source
  cd "$ROOT/integrations/ergates"
  "${UV_TEST[@]}" pytest contract
}

job_deploy() {
  cd "$ROOT"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env.example config --quiet
  uv run --no-project --python 3.11 --with pytest --with pyyaml pytest -p no:cacheprovider deploy/tests
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
