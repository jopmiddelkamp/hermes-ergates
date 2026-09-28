#!/usr/bin/env bash
# Builds the signed Android App Bundle of a store release (RELEASING.md).
# .github/workflows/release-build-android.yml runs it on ubuntu-latest after
# `npm ci`; on a Mac it needs Java 17, the Android SDK and the same variables.
#
# Needs: BUILD_NUMBER, ANDROID_UPLOAD_KEYSTORE_BASE64,
#        ANDROID_UPLOAD_KEYSTORE_PASSWORD, ANDROID_UPLOAD_KEY_ALIAS,
#        ANDROID_UPLOAD_KEY_PASSWORD
# Writes: $OUTPUT_DIR/ergates.aab (default apps/mobile/build/release)
#
# It regenerates apps/mobile/android (expo prebuild --clean) and puts app.json
# back as it found it. No secret is printed or put on a command line.
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$APP/build/release}"

missing=()
for name in BUILD_NUMBER ANDROID_UPLOAD_KEYSTORE_BASE64 ANDROID_UPLOAD_KEYSTORE_PASSWORD \
  ANDROID_UPLOAD_KEY_ALIAS ANDROID_UPLOAD_KEY_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "build-android: set ${missing[*]} first (RELEASING.md)" >&2
  exit 2
fi

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ergates-android.XXXXXX")"
cp "$APP/app.json" "$work/app.json"
cleanup() {
  cp "$work/app.json" "$APP/app.json"
  rm -rf "$work"
}
trap cleanup EXIT

(umask 077 && printf '%s' "$ANDROID_UPLOAD_KEYSTORE_BASE64" | base64 --decode > "$work/upload.jks")
export ANDROID_UPLOAD_KEYSTORE_PATH="$work/upload.jks"

cd "$APP"
node scripts/release/cli.mjs set-build-number "$BUILD_NUMBER"
CI=1 npx expo prebuild --platform android --clean --no-install
(cd android && ./gradlew --no-daemon app:bundleRelease)

mkdir -p "$OUTPUT_DIR"
cp android/app/build/outputs/bundle/release/app-release.aab "$OUTPUT_DIR/ergates.aab"
echo "build-android: wrote $OUTPUT_DIR/ergates.aab"
