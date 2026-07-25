# Household Planner Mobile

This is the native Expo app for iPhone and Android. It connects directly to the same Convex deployment as the web app, so accounts, passwords, tasks, task completion, assignment, notes, and reminder contact settings stay shared in real time.

## Run locally

Expo SDK 57 requires Node.js 22.13 or newer. The system Node.js on this computer was previously version 18, so install a current Node LTS before running Expo commands.

```powershell
cd mobile
Copy-Item .env.example .env
bun install
bun run start
```

The public Convex URL is preconfigured in `.env.example`. It is an endpoint address, not a secret. Household credentials and the recovery code remain only in Convex.

## iPhone testing

1. Create a free Expo account at [expo.dev](https://expo.dev), then run `bunx eas-cli login` from `mobile`.
2. Run `bunx eas-cli build --profile development --platform ios`.
3. Follow the EAS prompts to sign in to Apple. A paid Apple Developer Program membership is needed for device and App Store builds.
4. Install the generated development build on an iPhone, then run `bun run start` to load the app during development.

## TestFlight and App Store

1. In `mobile`, run `bunx eas-cli init` once. This links the app to the Expo account and writes an EAS project ID into `app.json`.
2. Confirm that `ios.bundleIdentifier` in `app.json` is available in your Apple Developer account. Change it before the first build only if `com.meer.householdplanner` is already taken.
3. Add the final privacy-policy URL: after this repository is deployed on Netlify, the included policy is available at `/privacy.html`.
4. Build the release candidate with `bun run build:ios`.
5. Upload it with `bun run submit:ios`. EAS can submit from Windows; the binary is built in the cloud.
6. In App Store Connect, complete the product page, privacy answers, age rating, support URL, and App Review notes. Give the reviewer an approved username, password, and recovery/setup process that works during review.
7. Send the build through TestFlight before App Review, then submit the tested build from App Store Connect.

The app has a real native agenda, task creation flow, profile settings, encrypted native token storage, and app-specific controls. It is not a website placed inside a web view.

## Security

- Native sign-in uses the existing Convex Password provider, so no second password database exists.
- Session and refresh tokens are stored through Expo SecureStore (iOS Keychain / Android Keystore-backed storage).
- Changing password or personal reminder contact details requires the current password.
- The password recovery screen requires the server-side `HOUSEHOLD_RECOVERY_CODE` (or the temporary setup-code fallback). Never add either code to this app, an Expo environment variable, or source control.
