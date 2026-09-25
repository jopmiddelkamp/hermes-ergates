# Releasing Ergates to TestFlight and Google Play

This runbook takes the app from this Mac to your phone through the stores. EAS (Expo Application Services) builds the app in the cloud and submits it. The release goes to **TestFlight** (iOS) and the **Google Play internal testing track** (Android). A public store release is a separate step, described at the end.

All secrets live in one folder, `apps/mobile/.release/`. Git ignores it, and the build upload leaves it out. A script, `scripts/release.mjs`, does the checks, the setup and the releases.

## Costs

| Item | Cost |
|---|---|
| Apple Developer Program | 99 USD per year ([Apple](https://developer.apple.com/support/enrollment/)). Organizations also need a D-U-N-S number. |
| Google Play developer account | 25 USD, one time ([Google](https://support.google.com/googleplay/android-developer/answer/6112435)) |
| EAS Build, free plan | 15 Android and 15 iOS builds per month, low-priority queue ([Expo](https://expo.dev/pricing)) |

## One-time setup

Start with `cp release.env.example .release/release.env` (make the folder first: `mkdir .release`). Fill in the values as you go.

### Step 1: Expo

1. Create a free account at [expo.dev](https://expo.dev).
2. Go to Account settings, then Access tokens. Create a personal access token.
3. Put it in `EXPO_TOKEN`.

### Step 2: Apple

1. Join the Apple Developer Program.
2. Copy your Team ID from developer.apple.com, Account, Membership details, into `APPLE_TEAM_ID`.
3. Create an App Store Connect API key: App Store Connect, Users and Access, Integrations, the plus button. Give it the **Admin** role ([Expo guide](https://github.com/expo/fyi/blob/main/creating-asc-api-key.md)).
4. Download the `.p8` file. Apple lets you download it **only once**. Save it as `.release/asc-api-key.p8`.
5. Copy the key's Key ID into `ASC_KEY_ID`, and the Issuer ID above the key list into `ASC_ISSUER_ID`.

### Step 3: Google

1. Create a Google Play developer account.
2. In Play Console, click **Create app**. Name: Ergates. Type: app, free.
3. Create the service account key ([Expo guide](https://github.com/expo/fyi/blob/main/creating-google-service-account.md)):
   - In Google Cloud, enable the **Google Play Android Developer API**.
   - Create a service account, then a **JSON** key. Save it as `.release/play-service-account.json`.
   - In Play Console, Users and permissions, invite the service account email. Give it the release permissions that the guide lists.
4. In Play Console, open Testing, Internal testing, and add your testers by email.
5. Keep `PLAY_RELEASE_STATUS=draft`. A Play app in draft status accepts only draft releases ([example of the error](https://github.com/fastlane/fastlane/discussions/18293)). Change it to `completed` after you finish the store listing and the setup tasks in Play Console.

### Step 4: Link and sign

Run these from `apps/mobile`:

```bash
npm run release:setup             # links the Expo project, locks down .release/ (owner-only)
npm run release:ios-credentials   # once, in YOUR terminal: it asks questions; answer yes
```

The second command registers the bundle ID `dev.ergates.mobile`, and creates the distribution certificate and the provisioning profile. It is the only step that asks questions. EAS cannot create the first certificate in non-interactive mode.

### Step 5: The App Store Connect app record

1. In App Store Connect, open Apps, the plus button, New App.
2. Choose iOS, the name Ergates, and the bundle ID `dev.ergates.mobile`. For the SKU, use any unique text, for example `ergates-ios`. The name must be unique on the App Store.
3. Open App Information and copy the **Apple ID** (digits) into `ASC_APP_ID`.
4. In TestFlight, add yourself to an internal testing group. Internal testers are App Store Connect users (up to 100). Builds for external testers may need Beta App Review ([Apple](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)).

### Step 6: Check

```bash
npm run release:check
```

It checks every value and file, and your Expo login. It prints problems by name and never prints a secret.

## Every release

```bash
npm run release           # both platforms
npm run release:ios       # or one platform
npm run release:android
```

The script runs the tests and the typecheck first. If both pass, it builds in the cloud and submits. EAS counts the build numbers up by itself (`appVersionSource: remote`). When the user-facing version changes, edit `version` in `app.json` first.

After the upload, TestFlight and Play need a few minutes to process the build. A TestFlight build expires after 90 days.

## Security notes

- `.release/` is in `.gitignore`, and the script refuses to run when git does not ignore it.
- EAS Submit receives the `.p8` key and the Play key so that it can submit for you. Expo stores them for that.
- To revoke access: revoke the API key in App Store Connect, delete the key in Google Cloud, and delete the token on expo.dev.

## Later: a public store release

This runbook stops at testing tracks. A public release also needs:

- A privacy policy URL, a store listing with screenshots, and the data-safety and content-rating forms.
- A way for Apple's reviewers to use the app. Ergates needs a Hermes server, so reviewers need a demo server and login.
- On a Google **personal** account created after 13 November 2023: a closed test with at least 12 testers, opted in for 14 days in a row, before production access. Internal testing does not count ([Google](https://support.google.com/googleplay/android-developer/answer/14151465)).
