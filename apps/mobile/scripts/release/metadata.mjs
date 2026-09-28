/**
 * Pure rules for a store release run (RELEASING.md): which version, channel
 * and build number a release tag gives, and the app.json the build uses.
 * No process, file-system or network access here, so Vitest covers every rule;
 * scripts/release/cli.mjs does the reading and writing.
 */

/** The highest versionCode Google Play accepts (developer.android.com/studio/publish/versioning). */
export const MAX_BUILD_NUMBER = 2_100_000_000

const RELEASE_TAG = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(-rc\.(?:0|[1-9]\d*))?$/

/**
 * `vX.Y.Z-rc.N` is an RC and `vX.Y.Z` is final; anything else is not a release tag (null).
 * The version drops the `-rc.N`: Apple allows only digits and dots in CFBundleShortVersionString.
 */
export function parseReleaseTag(tag) {
  const match = RELEASE_TAG.exec(tag)
  if (!match) return null
  return { version: match[1], channel: match[2] ? 'rc' : 'final' }
}

function wholeNumber(text) {
  return /^\d+$/.test(text) ? Number(text) : Number.NaN
}

function checkBuildNumber(buildNumber) {
  if (buildNumber > MAX_BUILD_NUMBER) {
    throw new Error(`The build number ${buildNumber} is above ${MAX_BUILD_NUMBER}, the highest versionCode Google Play accepts.`)
  }
  return buildNumber
}

/**
 * What a release run builds. `refType` and `refName` are the run's ref
 * (GITHUB_REF_TYPE, GITHUB_REF_NAME), `offset` is the BUILD_NUMBER_OFFSET
 * variable and `override` the build-number input of a manual run; both may
 * be empty. `appVersion` is `expo.version` in apps/mobile/app.json at the tag.
 * Throws an Error whose message says what to do.
 */
export function resolveRelease({ refType, refName, runNumber, offset, override, appVersion }) {
  if (refType !== 'tag') {
    throw new Error(`A release run needs a release tag, but this run is on the ${refType} ${refName}. Start a manual run on the tag: gh workflow run release.yml --ref vX.Y.Z-rc.N`)
  }
  const parsed = parseReleaseTag(refName)
  if (!parsed) {
    throw new Error(`A release run needs a release tag (vX.Y.Z or vX.Y.Z-rc.N), but this run is on the tag ${refName}.`)
  }
  if (appVersion !== parsed.version) {
    throw new Error(`apps/mobile/app.json has version ${appVersion}, but the tag ${refName} is version ${parsed.version}. gflow runs .gflow/set-version.sh when it starts a release; check that the script ran and its commit is in the tag.`)
  }
  let buildNumber
  if (override) {
    buildNumber = wholeNumber(override)
    if (!(buildNumber >= 1 && buildNumber <= MAX_BUILD_NUMBER)) {
      throw new Error(`The build-number input must be a whole number from 1 to ${MAX_BUILD_NUMBER}, got "${override}".`)
    }
  } else {
    const run = wholeNumber(runNumber)
    if (!(run >= 1)) {
      throw new Error(`GITHUB_RUN_NUMBER must be a whole number of 1 or more, got "${runNumber}".`)
    }
    const extra = offset ? wholeNumber(offset) : 0
    if (Number.isNaN(extra)) {
      throw new Error(`The BUILD_NUMBER_OFFSET variable must be a whole number of 0 or more, got "${offset}".`)
    }
    buildNumber = checkBuildNumber(run + extra)
  }
  return { tag: refName, version: parsed.version, channel: parsed.channel, buildNumber }
}

/** The lines the metadata job appends to $GITHUB_OUTPUT. */
export function formatOutputs({ tag, version, channel, buildNumber }) {
  return `tag=${tag}\nversion=${version}\nchannel=${channel}\nbuild-number=${buildNumber}\n`
}

/**
 * app.json with the build number as iOS CFBundleVersion (`ios.buildNumber`)
 * and Android `versionCode`. The runner writes it before `expo prebuild`;
 * it is never committed.
 */
export function withBuildNumber(appJson, buildNumber) {
  if (!Number.isInteger(buildNumber) || buildNumber < 1 || buildNumber > MAX_BUILD_NUMBER) {
    throw new Error(`The build number must be a whole number from 1 to ${MAX_BUILD_NUMBER}, got ${buildNumber}.`)
  }
  const next = structuredClone(appJson)
  next.expo.ios = { ...next.expo.ios, buildNumber: String(buildNumber) }
  next.expo.android = { ...next.expo.android, versionCode: buildNumber }
  return next
}
