#!/usr/bin/env bash
# Creates the Android upload keystore .release/android-upload.jks with keytool,
# using the alias and passwords in .release/release.env (RELEASING.md). The
# passwords reach keytool through its environment, never its arguments. It
# refuses to replace an existing keystore: Google Play knows the upload key.
#
# set +x first: a caller running this with `bash -x`, or one that inherits
# `set -x` from its own environment, must not get secret values traced onto
# stderr.
set +x
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec node scripts/release/cli.mjs make-upload-keystore
