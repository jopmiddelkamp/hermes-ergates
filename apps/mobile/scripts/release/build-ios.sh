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

profile_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null || true
}

# What cli.mjs ios-signing checks: the profile's name, team, app ID and kind,
# read from an already-decoded profile plist (what `security cms -D` writes
# from the .mobileprovision; only that decode needs `security` -- this
# function does not). Sets the PROFILE_* variables. Refuses a plist that does
# not parse, or one with no Name or UUID, with a clear message and nothing
# else printed: most likely `security cms -D` wrote something that is not a
# provisioning profile.
read_profile_fields() {
  local plist="$1"
  if ! /usr/libexec/PlistBuddy -c "Print" "$plist" > /dev/null 2>&1; then
    echo "build-ios: $plist did not parse as a plist. Is IOS_APPSTORE_PROFILE_BASE64 a .mobileprovision file?" >&2
    return 1
  fi
  PROFILE_NAME="$(profile_value "$plist" Name)"
  PROFILE_UUID="$(profile_value "$plist" UUID)"
  if [[ -z "$PROFILE_NAME" || -z "$PROFILE_UUID" ]]; then
    echo "build-ios: $plist has no Name or UUID. Is IOS_APPSTORE_PROFILE_BASE64 a .mobileprovision file?" >&2
    return 1
  fi
  PROFILE_TEAM_ID="$(profile_value "$plist" TeamIdentifier:0)"
  PROFILE_APP_ID="$(profile_value "$plist" Entitlements:application-identifier)"
  PROFILE_GET_TASK_ALLOW="$(profile_value "$plist" Entitlements:get-task-allow)"
  PROFILE_DEVICES="$(profile_value "$plist" ProvisionedDevices)$(profile_value "$plist" ProvisionsAllDevices)"
}

# Refuses anything but exactly one workspace, before its name feeds -scheme
# and -workspace below; prints its path. No Xcode needed: this only globs.
# nullglob, restored after: without it, a dir with no match leaves the
# pattern itself as a literal, one-element array -- a false "found 1".
require_one_workspace() {
  local dir="$1"
  local restore_nullglob
  # shopt -p exits 1 when the option is already off (it still prints the
  # command to restore it), which set -e would otherwise treat as a failure.
  restore_nullglob="$(shopt -p nullglob || true)"
  shopt -s nullglob
  local workspaces=("$dir"/*.xcworkspace)
  eval "$restore_nullglob"
  if [[ ${#workspaces[@]} -ne 1 ]]; then
    echo "build-ios: expected exactly one $dir/*.xcworkspace, found ${#workspaces[@]}${workspaces[*]:+ (${workspaces[*]})}" >&2
    return 1
  fi
  echo "${workspaces[0]}"
}

if [[ "${1:-}" == "--cleanup" ]]; then
  remove_signing
  exit 0
fi

# Test hooks: exercise read_profile_fields and require_one_workspace on their
# own, without a decoded certificate, Xcode, or BUILD_NUMBER and the other
# variables the full build needs.
if [[ "${1:-}" == "--read-profile-fields" ]]; then
  read_profile_fields "${2:-}"
  printf 'NAME=%s\nUUID=%s\nTEAM_ID=%s\nAPP_ID=%s\nGET_TASK_ALLOW=%s\nDEVICES=%s\n' \
    "$PROFILE_NAME" "$PROFILE_UUID" "$PROFILE_TEAM_ID" "$PROFILE_APP_ID" "$PROFILE_GET_TASK_ALLOW" "$PROFILE_DEVICES"
  exit 0
fi
if [[ "${1:-}" == "--require-one-workspace" ]]; then
  require_one_workspace "${2:-ios}"
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

security cms -D -i "$work/appstore.mobileprovision" > "$work/profile.plist"
read_profile_fields "$work/profile.plist"
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

workspace="$(require_one_workspace ios)"
scheme="$(basename "$workspace" .xcworkspace)"
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
