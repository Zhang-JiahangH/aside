# Android distribution with Expo EAS

Aside uses the existing Expo login `jiahangzhang` and its own [Aside project](https://expo.dev/accounts/jiahangzhang/projects/aside). The project ID is `91adc426-36cf-4264-a618-63e33b112cda`; Pax's project is independent.

## Install

Open the successful Android build's EAS installation page on an Android phone, download the APK, and allow that browser to install apps when Android prompts. Install over the previous Aside release to retain the account and local settings. The current internal profile targets **ARM64 Android devices**, uses `com.asidefm.app`, and connects to `https://asidefm.com`.

This is a standalone Release APK with embedded JavaScript. Expo Go, Metro, a USB connection and a developer computer are not required. EAS hosts the build and installation link; this does not publish an app to Google Play. Anyone with an unrestricted internal-build link can download it, so share it with the intended testers.

## Build the next release

From the repository root, with Node 24 and the Expo account signed in:

```sh
npm ci
npm run build:apk -w @aside/mobile -- --non-interactive --no-wait
```

The command prints an EAS build page. Wait for that build to finish successfully before sharing its installation link. EAS manages the increasing Android version code; each new release replaces the previous one. The public app version is maintained in `mobile/app.config.ts` and `mobile/package.json`.

The build wrapper requires the existing private files `mobile/.credentials/internal.keystore` and `mobile/.credentials/android.json`. It prepares `mobile/credentials.json` with restrictive file permissions so EAS can use that key. These files are ignored by Git and excluded from the source archive. Keep a secure backup of the key and password. Do not generate a different key for an update.

Expected signing certificate SHA-256:

```text
a1145c78a613303fc04edb9b6352d7a00ffa0b6c971ea59a03f50798df9e597f
```

The internal profile fixes the production API and disables fixture mode. `.easignore` includes the shared runtime and engine while excluding local acceptance records, credentials, artifacts and generated native projects. EAS generates the Android project and injects release signing during its build. OTA JavaScript updates are disabled.

## Release checks

1. Check that EAS reports a successful build for the intended commit and a higher version code.
2. Download its APK and verify the package, version, ARM64 ABI and signing certificate with Android SDK tools.
3. Install over the preceding release; check that the signed-in account survives and real public audio loads.
4. Run the production smoke flows in `mobile/tests/online-public.yaml` and `online-signed-in.yaml`. These flows do not submit model questions. Complete any separately authorized real-model check once, without automatic paid retries.
5. Share the verified build's EAS installation page. Signing and releasing iOS are separate from this Android process.

For native development, backend compatibility and broader acceptance instructions, see [mobile setup](mobile.md) and [mobile tests](../mobile/tests/README.md).
