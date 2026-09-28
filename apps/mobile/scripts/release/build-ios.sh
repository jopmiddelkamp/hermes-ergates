#!/usr/bin/env bash
# Builds the signed App Store .ipa of a store release (RELEASING.md).
# .github/workflows/release-build-ios.yml runs it on macos-latest after
# `npm ci`; on a Mac it needs Xcode 26.4 or later, CocoaPods and the same
# variables.
#
# Needs: BUILD_NUMBER, APPLE_TEAM_ID, IOS_DIST_CERT_P12_BASE64,
#        IOS_DIST_CERT_PASSWORD, IOS_APPSTORE_PROFILE_BASE64
# Writes: $OUTPUT_DIR/ergates.ipa (default apps/mobile/build/release)
#
# It regenerates apps/mobile/ios (expo prebuild --clean) and puts app.json
# back as it found it. The certificate goes into a temporary keychain that is
# added to the user's keychain search list next to the existing ones and is
# deleted at the end, also on failure; `build-ios.sh --cleanup` does only that
# deletion. No secret is printed; the .p12 password reaches `security import`
# as an argument, the only way that command takes it.
#
# set +x first: a caller running this with `bash -x`, or one that inherits
# `set -x` from its own environment, must not get secret values traced onto
# stderr.
set +x
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$APP/build/release}"
KEYCHAIN="$HOME/Library/Keychains/ergates-release.keychain-db"
PROFILE_FILE="ergates-release.mobileprovision"
# Xcode 16 and later read profiles from UserData; older tools from MobileDevice.
PROFILE_DIRS=(
  "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
  "$HOME/Library/MobileDevice/Provisioning Profiles"
)

remove_signing() {
  security delete-keychain "$KEYCHAIN" 2>/dev/null || true
  local dir
  for dir in "${PROFILE_DIRS[@]}"; do
    rm -f "$dir/$PROFILE_FILE"
  done
}

if [[ "${1:-}" == "--cleanup" ]]; then
  remove_signing
  exit 0
fi

missing=()
for name in BUILD_NUMBER APPLE_TEAM_ID IOS_DIST_CERT_P12_BASE64 IOS_DIST_CERT_PASSWORD \
  IOS_APPSTORE_PROFILE_BASE64; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "build-ios: set ${missing[*]} first (RELEASING.md)" >&2
  exit 2
fi

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ergates-ios.XXXXXX")"
cp "$APP/app.json" "$work/app.json"
cleanup() {
  remove_signing
  cp "$work/app.json" "$APP/app.json"
  rm -rf "$work"
}
trap cleanup EXIT

(umask 077 && printf '%s' "$IOS_DIST_CERT_P12_BASE64" | base64 --decode > "$work/distribution.p12")
(umask 077 && printf '%s' "$IOS_APPSTORE_PROFILE_BASE64" | base64 --decode > "$work/appstore.mobileprovision")

# What cli.mjs ios-signing checks: the profile's name, team, app ID and kind.
security cms -D -i "$work/appstore.mobileprovision" > "$work/profile.plist"
profile_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$work/profile.plist" 2>/dev/null || true
}
PROFILE_NAME="$(profile_value Name)"
PROFILE_UUID="$(profile_value UUID)"
PROFILE_TEAM_ID="$(profile_value TeamIdentifier:0)"
PROFILE_APP_ID="$(profile_value Entitlements:application-identifier)"
PROFILE_GET_TASK_ALLOW="$(profile_value Entitlements:get-task-allow)"
PROFILE_DEVICES="$(profile_value ProvisionedDevices)$(profile_value ProvisionsAllDevices)"
export PROFILE_NAME PROFILE_UUID PROFILE_TEAM_ID PROFILE_APP_ID PROFILE_GET_TASK_ALLOW PROFILE_DEVICES

remove_signing
keychain_password="$(openssl rand -hex 24)"
security create-keychain -p "$keychain_password" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$keychain_password" "$KEYCHAIN"
security import "$work/distribution.p12" -P "$IOS_DIST_CERT_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN"
security set-key-partition-list -S apple-tool:,apple: -k "$keychain_password" "$KEYCHAIN" > /dev/null
searched=()
while IFS= read -r line; do
  searched+=("$(printf '%s' "$line" | sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//')")
done < <(security list-keychains -d user)
security list-keychains -d user -s "$KEYCHAIN" ${searched[@]+"${searched[@]}"}
for dir in "${PROFILE_DIRS[@]}"; do
  mkdir -p "$dir"
  cp "$work/appstore.mobileprovision" "$dir/$PROFILE_FILE"
done

cd "$APP"
node scripts/release/cli.mjs set-build-number "$BUILD_NUMBER"
CI=1 npx expo prebuild --platform ios --clean --no-install
(cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install)
node scripts/release/cli.mjs ios-signing "$work/ExportOptions.plist"

scheme="$(basename ios/*.xcworkspace .xcworkspace)"
xcodebuild -quiet archive \
  -workspace "ios/$scheme.xcworkspace" \
  -scheme "$scheme" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$work/$scheme.xcarchive"
xcodebuild -quiet -exportArchive \
  -archivePath "$work/$scheme.xcarchive" \
  -exportPath "$work/export" \
  -exportOptionsPlist "$work/ExportOptions.plist"

mkdir -p "$OUTPUT_DIR"
cp "$work/export/$scheme.ipa" "$OUTPUT_DIR/ergates.ipa"
echo "build-ios: wrote $OUTPUT_DIR/ergates.ipa"
