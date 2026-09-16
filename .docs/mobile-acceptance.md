# Mobile acceptance — September 15, 2026

Branch: `codex/mobile-cross-platform`. [Pull request #2](https://github.com/qiz029/aside/pull/2).

## Release readiness correction

**This is local integration evidence. The mobile app is not ready for production use.** On September 15 at 20:22 PDT, the production mobile email-start route returned `403 Origin required` without an Origin and `404` with the website Origin. Production D1 still listed `0006_mobile.sql` as unapplied. The installed simulator binaries connect to temporary local data and fixed test codes; they cannot demonstrate real email delivery or synchronization with website accounts. Restoring the fixture service does not close these gaps.

Subsequent rollout preparation exported an owner-only, ignored production D1 backup and successfully applied `0006_mobile.sql`. Production health and website session endpoints still returned 200 afterward. The production Worker, website and media container have **not** been published: automatic approval review rejected that deployment, requiring explicit user authorization after the remaining native checks and fixes are reviewable. The added database columns remain in place. Real email delivery, production sign-in and website-account restoration are still pending; a fixture code must not be counted as that acceptance.

The branch now also integrates upstream `db40343`, including asynchronous voice controls, early Live input, the player dock layout, reduced analysis prompts and question-cost accounting. Voice controls live in the shared runtime while retaining async native seeking, complete-history persistence and cancellation. A second breath preserves unclassified context in memory, and cancelled/unclassified fragments stay out of synchronized history. The local Worker fixtures read every migration in order, including both `0006_mobile.sql` and upstream `0006_question_usage.sql`, so the auth and cost ledger tests share the complete schema.

Login follow-up fixes preserve stored credentials across failed session lookups, distinguish an expired session from a connection outage, offer explicit reconnection, and add a two-step email/code form with resend cooldown and error recovery. Keyboard entry hides surrounding navigation so the send action stays reachable. Distribution configurations reject test flags and localhost/non-HTTPS API URLs; explicit local test builds identify their separate data on the Account screen. Real email delivery and production account restoration remain outstanding.

The follow-up passed **164 unit tests**, **32 Worker integration tests**, and **46 browser tests** in a complete run. iOS and Android passed invalid-email, resend-cooldown, wrong-code, successful-login, process-restart and disconnected-start/reconnection checks without clearing saved credentials. [iOS login](mobile-evidence/login-ios.txt), [Android login](mobile-evidence/login-android.txt), [iOS reconnection](mobile-evidence/login-ios-reconnect.txt), [Android reconnection](mobile-evidence/login-android-reconnect.txt). The final media image returned 16 kHz mono PCM WAV from M4A and rejected an overlong recording with 422.

After the subsequent cost-control merge, **170 unit tests**, **33 Worker integration tests** and **46 browser tests** passed, along with all TypeScript/boundary checks, web build, production Worker dry run and media Docker build. [Unit results](mobile-evidence/cost-merged-unit.txt), [Worker results](mobile-evidence/cost-merged-cloudflare.txt), [Browser results](mobile-evidence/cost-merged-browser.txt). The incoming engine change only removes unused TypeScript word metadata; installed native runtime/UI code is unchanged. Production rollout must also verify/apply upstream's `0006_question_usage.sql` before deploying the merged Worker.

Native packaging now resolves the shared workspace's `.js` TypeScript specifiers. Android bundle inputs explicitly track `engine`, `player-runtime` and build API/environment variables, so incremental builds cannot silently reuse old shared code or the wrong endpoint.

Final login layout verification passed the full native smoke and voice flows on the iPhone SE 3 and Android emulator. Language selection stays reachable above the form; the keyboard cannot redirect the send action into another tab. [iPhone SE smoke](mobile-evidence/login-final-ios-smoke.txt), [Android smoke](mobile-evidence/login-final-android-smoke.txt), [iPhone SE voice](mobile-evidence/login-final-ios-voice.txt), [Android voice](mobile-evidence/login-final-android-voice.txt). These remain mock-service checks.

### Minimal real-service acceptance before distribution

The user authorized detailed mock regression and requested one real end-to-end smoke to control model costs. After production approval, use a designated real mailbox, play an existing analyzed episode, ask one short voice question, and restore that account's progress and completed conversation on the website. Do not repeat paid questions automatically or analyze a long new upload for this check. Record actual delivery, answer playback and synchronized state; do not substitute a fixed code or canned model response. Real-service success is still pending.

Online API candidate builds have been prepared separately from fixtures. Their embedded configuration was inspected: `apiUrl=https://asidefm.com`, `testApi=false`. The Android candidate uses the production package `com.asidefm.app`; its signature passed `apksigner verify` and installation on the ARM64 emulator passed. It retains the local signing key used for future updates. The iOS candidate uses the local bundle identifier and installs on the dedicated simulator. Compilation and installation alone do not establish online readiness.

Both installed online candidates also passed the read-only production smoke: the actual public library and `luxun-ah-q` transcript loaded, and the test environment banner was absent. [iOS online public smoke](mobile-evidence/online-ios-public.txt), [Android online public smoke](mobile-evidence/online-android-public.txt). This made no email submissions or paid model calls. Production signed-in functionality still awaits the Worker rollout and one real end-to-end acceptance.

Product readiness and distribution are independent acceptance tracks. Every app feature must use the online business service; one real complete flow closes the end-to-end acceptance, with broader mock regression controlling cost. Android requires a signed Release APK. Current iOS acceptance is Personal Team local installation, with Ad Hoc IPA export and TestFlight submission supported separately. Apple membership must not delay completing online functionality. The production Android namespace exposed a stale native linking cache when switching from the development variant; the release script now regenerates those derived outputs, and the production APK build passed.

Installed **Release** builds were tested on iPhone 16 Pro and iPhone SE 3 simulators (iOS 18.3), and Pixel 6 / API 33 ARM64 Android emulator. JavaScript is embedded; Metro was not used. Tests exercised the real local Worker, D1, R2, FFmpeg media decoder and analysis workflow. External transcription/model results were deterministic fixtures; voice answers used a real receive-only WebRTC peer and audio/data transport.

## Earlier integration with PR #1

The branch includes upstream `527bc64` (PR #1 player controls, live waveform, monthly upload quota and one-step media segmentation). Its command/configuration policy now lives in the shared listening runtime, retaining native asynchronous seeking, completed-history persistence and conflict protection. The native adapter applies rate, volume, mute and pitch configuration. After merging, both native Release packages were rebuilt and the expanded regression suites rerun. Expanded verification: [132 unit tests](mobile-evidence/merged-unit-tests.txt), [32 Worker tests](mobile-evidence/merged-cloudflare-tests.txt), [44 browser tests](mobile-evidence/merged-browser-tests.txt), [iOS smoke](mobile-evidence/merged-ios-smoke.txt), [Android smoke](mobile-evidence/merged-android-smoke.txt), [iOS voice](mobile-evidence/merged-ios-voice.txt), [Android voice](mobile-evidence/merged-android-voice.txt), [iOS upload](mobile-evidence/merged-ios-upload.txt), [Android upload](mobile-evidence/merged-android-upload.txt). The incoming browser fixture was updated to return versioned checkpoint writes instead of `null`, matching the new production contract.

## Earlier feature and endurance results

| Check | Result / evidence |
| --- | --- |
| TypeScript and shared/native import boundaries | Passed `npm run check` |
| Unit and application regression | **132 passed**, including audio ownership, late events, fixed anchors, asynchronous seeking, cancellation, checkpoint races and real M4A validation |
| Cloudflare integration | **32 passed**, including bearer expiry/revocation, private-media isolation, Range requests and checkpoint compare-and-swap |
| Website browser regression | **44 passed**; production web build passed |
| Native Release compilation / installation | Both platforms passed locally; standalone embedded JS |
| Public library and transport | Both passed: playback/pause, seeking, speed, transcript and navigation |
| Account and private media | Both passed: email code, locale, account, logout, native file picker, multipart upload, real analysis and private transcript/playback |
| Voice question and follow-up | Both passed: native M4A capture, transcription, receive-only RTC answer, manual continuation and natural continuation |
| Recording cap | iOS capture **29.538 s**, Android **29.522 s**; automatically submitted; service checkpoint grew from one complete pair to two complete pairs |
| Permission denial / cancellation | Both passed: denied permission gives Settings recovery, slide-out cancellation, question background cancellation, foreground remains paused |
| Upload background cancellation / retry | Both passed with delayed upload parts: server-side multipart deletion, localized retry explanation, then explicit retry completed analysis and opened the transcript |
| Progress and conversation synchronization | Completed Android history restored in iOS and website; both conflict choices verified against actual Worker versions, including native iOS selection |
| Visual and interaction review | Both: light/dark, Chinese/English, large text, keyboard avoidance, scroll reachability. iPhone SE small-screen verification included |
| Media container | Actual image built and started; `/health` passed; M4A decoded to 16 kHz mono PCM WAV; invalid and 31-second inputs rejected with 422; no question temporary directories remained |

Upload evidence: [iOS cancellation](mobile-evidence/ios-upload-cancelled.txt), [Android cancellation](mobile-evidence/android-upload-cancelled.txt), [iOS retry](mobile-evidence/ios-upload-retry.txt), [Android retry](mobile-evidence/android-upload-retry.txt), [server cancellation/completion requests](mobile-evidence/upload-cancellation-server.txt). The final binaries containing the localized cancellation copy were rebuilt, installed and tested on both platforms.

## Sustained background playback and system controls

A real 31-minute silent AAC file was played without JS-dependent background timing. Timestamps below are test-host PDT on September 15, 2026.

- **Android:** screen off from approximately 12:07:33; at 12:37:35 native playback exceeded 30 minutes. Subsequent media-session state showed playing at 1,825,251 ms, paused at 1,828,178 ms after a system pause, and playback resumed after a system play command. [Playing state](mobile-evidence/android-background-playing.txt), [paused state](mobile-evidence/android-background-paused.txt), [foreground position](mobile-screenshots/android-30min-paused.png).
- **iOS:** playback started at 12:34:31; device locked at 12:35:09–11. At 13:05:14 the system pause command changed the native AVPlayer from Playing to Paused; system play at 13:05:17 and pause at 13:05:21 produced the corresponding native transitions. Reopening showed **30:47**. [Native control log](mobile-evidence/ios-background-controls.txt), [command timestamps](mobile-evidence/ios-system-commands.txt), [foreground position](mobile-screenshots/ios-30min-paused.png).
- The endurance iOS binary preceded the small SDK metadata backport: its old system metadata still said rate 1 while native playback was paused. The final rebuilt binary was separately verified to report rate **0** on pause. Native audio ownership/transport behavior is unchanged by that backport.
- These iOS simulators did not render the visible lock-screen media card, including with an independent plain AVPlayer/MPRemoteCommandCenter probe. Native Now Playing registration, commands and actual playback were verified. Visible lock-screen card layout remains a physical-device check; a simulator screenshot is not claimed as proof of that card.

## Visual evidence

Screenshots are from installed applications, not design mockups. See [design decisions and Apple HIG references](mobile-design.md).

| iOS | Android |
| --- | --- |
| [Small-screen player, dark / large text](mobile-screenshots/ios-dark-large-player.png) | [Player, dark / large text](mobile-screenshots/android-dark-large-player.png) |
| [Account](mobile-screenshots/ios-dark-large-account.png) | [Account](mobile-screenshots/android-dark-large-account.png) |
| [Library](mobile-screenshots/ios-dark-large-library.png) · [Upload](mobile-screenshots/ios-dark-large-upload.png) | [Recording permission recovery](mobile-screenshots/android-microphone-denied.png) |
| [Recording permission recovery](mobile-screenshots/ios-microphone-denied.png) | [Capped follow-up](mobile-screenshots/android-capped-followup.png) |
| [Capped follow-up](mobile-screenshots/ios-capped-followup.png) | [Website synchronized conversation](mobile-screenshots/web-synchronized.png) |
| [Light private player](mobile-screenshots/ios-light-private-player.png) · [Light account](mobile-screenshots/ios-light-account.png) · [Light library](mobile-screenshots/ios-light-library.png) | [Private player after merge](mobile-screenshots/android-merged-private-player.png) |
| [Cancelled upload](mobile-screenshots/ios-upload-cancelled.png) · [Retry completed](mobile-screenshots/ios-upload-retried.png) | [Cancelled upload](mobile-screenshots/android-upload-cancelled.png) · [Retry completed](mobile-screenshots/android-upload-retried.png) |

## Fixes found through native acceptance

- Flattened native recorder options and verified actual recording readiness before showing its timer.
- Serialized audio-session ownership. Late answer cleanup and delayed playback events cannot stop a new capture or restart an intentionally paused episode.
- Kept the native audio session active through ownership transitions instead of allowing SDK delayed deactivation to stop recording.
- Waited for loaded native media before playback; stale async seek/play work is fenced by revisions.
- Dismissed numeric verification keyboard after all eight digits, and kept controls reachable on iPhone SE and at large text sizes.
- Published episode/checkpoint replacement atomically and fenced stale cache writes/queued saves. Conflicts require an explicit choice.
- Used `signal.aborted` for SDK 54 upload cancellation and provided a localized cancellation explanation with retry.
- Backported upstream expo/expo#44974 so paused Now Playing metadata stops advancing.
- Updated media Docker workspace manifests and excluded generated native projects, artifacts and signing credentials from its context.

Initial incorrect-MIME iOS endurance attempts and transient model-fixture failures were excluded from accepted results. The corrected long fixture uses `audio/mp4`. The native fixture fully consumes upstream request bodies; repeated native voice turns were rerun against it. Failed paid questions remain paused and are never automatically retried.

## CI and installation artifacts

- [CI: types, 132 unit/application tests, 32 Cloudflare tests, web build and Docker build](https://github.com/Zhang-JiahangH/aside/actions/runs/35020001141).
- [Both native Release builds](https://github.com/Zhang-JiahangH/aside/actions/runs/35020004213).
- [iOS native metadata backport build](https://github.com/Zhang-JiahangH/aside/actions/runs/35018001221).

CI runs on the contribution fork because the connected GitHub account has read access to the upstream repository. The PR targets `qiz029/aside:main`; no upstream branch protection or production settings were changed.

Local `mobile/artifacts/AsideDev-simulator-validation.zip` and `aside-validation-arm64.apk` are ARM64 simulator/emulator validation artifacts pointing to localhost:4311. They use the local bundle identifier. The local Android key persists in ignored credentials and supports updates. CI's Android key is ephemeral and is for build validation only. See [native harness instructions](../mobile/tests/README.md). Production API builds and signing commands are documented in [mobile setup](mobile.md).

## Separate device / distribution acceptance

No production Worker/container publication or Apple distribution is claimed. Migration `0006_mobile.sql` is now applied. After explicit production approval, deploy the media container and Worker with native recording disabled, verify readiness, then enable `MOBILE_AUDIO_ENABLED` before production native voice use.

Personal Team installation/trust, physical calls/headphone and Bluetooth interruptions, visible iOS lock-screen controls, battery behavior, Ad Hoc registered-device installation and TestFlight need their actual device/signing environments. Apple paid membership is pending. The local/internal/testflight configurations and separate build/submit commands are present; Ad Hoc and TestFlight are **pending signing acceptance**. Synthetic model fixtures do not establish real-model response quality or end-to-end production latency.

Local prerequisites checked on this Mac: `security find-identity -p codesigning` reported **0 valid identities**, and `devicectl` reported **0 physical devices**. Simulator installation passed, but a signed iPhone installation has not been performed. The user must add their Personal Team in Xcode and connect/trust a device for that step.
