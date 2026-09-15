# Mobile acceptance — in progress

Branch: `codex/mobile-cross-platform`. No production deployment or Apple distribution has been completed. Native tests use installed Release binaries with embedded JavaScript, a real local Worker/D1/R2/media service and a synthetic external model/WebRTC peer.

## Completed checks

- TypeScript/import boundaries and production web build: passed.
- Unit/application tests: **108 passed**, including real FFmpeg M4A validation, native audio ownership and checkpoint race regression tests.
- Cloudflare integration: **30 passed**.
- Web browser regression: **36 passed**.
- Android Release on Pixel 6 / API 33: email login, public playback, seeking, speed, text answer/resume, locale, logout and native recording/voice answer/manual resume/background transition passed.
- iOS Release on iPhone 16 Pro / iOS 18.3: complete smoke flow passed. iPhone SE 3: small-screen login, actual M4A capture/transcription, receive-only voice answer and natural resume passed.
- Native system file selection, upload, real media analysis and private transcript/playback passed on both platforms.
- Completed Android conversation restored in iOS and the website with the same account.
- Website conflict choices were verified against real Worker versions: use remote seeks to the remote position; keep local writes the chosen local position with the observed remote version.

## Fixes validated during acceptance

- Native recorder options are flattened correctly, and recording readiness is checked before showing a timer.
- Audio-session ownership replaces delayed automatic deactivation; old voice cleanup cannot stop a new recording or resumed podcast.
- Numeric verification entry dismisses its keyboard when the full code is entered, keeping submission reachable on small screens.
- React Native upload cancellation checks `signal.aborted`, because SDK 54 does not provide `throwIfAborted`.
- Episode/checkpoint replacement publishes one complete state; pending cache writes and queued saves cannot overwrite a newly selected or remote checkpoint.
- The generated M4A long-playback fixture now uses `audio/mp4`. The previous incorrect `audio/mpeg` response was rejected by native AVPlayer. Those earlier iOS background attempts are **not** accepted evidence.
- A transient local model-fixture request timed out; its failed turn remained paused until explicit continuation. Subsequent newly recorded voice answers and natural resume passed. No automatic paid-request retry was added.

## Verification still running

- Thirty minutes of sustained native **locked-screen** playback, followed by system controls and native position checks. Android started around 12:07 and corrected iOS around 12:16 on September 15, 2026 (local test-host time). Exact timestamps are retained in Maestro reports.
- Native conflict choices, dark appearance / large text, cancellation and foreground recovery checks.
- Final branch push, CI results and completed PR.

## Separately pending device/distribution checks

Personal Team installation/trust, physical calls/headphones, Ad Hoc registered-device installation and TestFlight require their actual devices/signing environments. Paid Apple membership is still pending. Simulator installation does not prove these signing channels or real-model response quality/latency.
