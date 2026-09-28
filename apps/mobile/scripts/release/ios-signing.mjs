/**
 * Pure rules for signing the iOS release (RELEASING.md): whether the App Store
 * provisioning profile fits the app, and the ExportOptions.plist that
 * `xcodebuild -exportArchive` signs the .ipa with. No process or file access
 * here; scripts/release/build-ios.sh reads the profile and cli.mjs writes files.
 */

/**
 * What is wrong with the profile for an App Store build, as sentences; empty
 * when it fits. The fields are what build-ios.sh reads from the decoded
 * profile: Name, UUID, TeamIdentifier:0, Entitlements:application-identifier,
 * Entitlements:get-task-allow ('true' or 'false'), and whether the profile
 * lists devices (ProvisionedDevices or ProvisionsAllDevices).
 */
export function appStoreProfileProblems(profile, { teamId, bundleId }) {
  const problems = []
  if (!profile.name || !profile.uuid) {
    problems.push('The provisioning profile has no Name or UUID. Is IOS_APPSTORE_PROFILE_BASE64 a .mobileprovision file?')
  }
  if (profile.teamId !== teamId) {
    problems.push(`The provisioning profile belongs to team ${profile.teamId || '(none)'}, not to APPLE_TEAM_ID ${teamId}.`)
  }
  if (profile.appId !== `${teamId}.${bundleId}`) {
    problems.push(`The provisioning profile is for the app ID ${profile.appId || '(none)'}, not ${teamId}.${bundleId}.`)
  }
  if (profile.getTaskAllow !== 'false' || profile.hasDevices) {
    problems.push('The provisioning profile is a development or ad hoc profile. Create an App Store profile (RELEASING.md).')
  }
  return problems
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

function xml(text) {
  return String(text).replace(/[&<>"']/g, character => XML_ESCAPES[character])
}

/**
 * ExportOptions.plist for a manually signed App Store Connect export
 * (`xcodebuild -help` lists the keys). The .ipa is written to disk; the
 * upload job sends it to TestFlight, and the build number stays the one the
 * release run chose.
 */
export function exportOptionsPlist({ teamId, bundleId, profileName }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>destination</key>',
    '  <string>export</string>',
    '  <key>manageAppVersionAndBuildNumber</key>',
    '  <false/>',
    '  <key>method</key>',
    '  <string>app-store-connect</string>',
    '  <key>provisioningProfiles</key>',
    '  <dict>',
    `    <key>${xml(bundleId)}</key>`,
    `    <string>${xml(profileName)}</string>`,
    '  </dict>',
    '  <key>signingCertificate</key>',
    '  <string>Apple Distribution</string>',
    '  <key>signingStyle</key>',
    '  <string>manual</string>',
    '  <key>teamID</key>',
    `  <string>${xml(teamId)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}
