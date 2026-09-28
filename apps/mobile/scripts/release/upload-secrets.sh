#!/usr/bin/env bash
# Puts the store release secrets into the GitHub environment app-stores
# (RELEASING.md). It reads apps/mobile/.release (or ERGATES_RELEASE_DIR),
# creates or repairs the app-stores environment (always PUT) and adds the v*
# tag rule when it is missing, and sets every secret through gh on stdin. It
# prints names, never values.
#
#   scripts/release/upload-secrets.sh --check   list what is missing, upload nothing
#   scripts/release/upload-secrets.sh           upload
#
# set +x first: a caller running this with `bash -x`, or one that inherits
# `set -x` from its own environment, must not get secret values traced onto
# stderr.
set +x
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
case "${1:-}" in
  --check) exec node scripts/release/cli.mjs secrets-check ;;
  "") exec node scripts/release/cli.mjs secrets-upload ;;
  *)
    echo "usage: scripts/release/upload-secrets.sh [--check]" >&2
    exit 2
    ;;
esac
