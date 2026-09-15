# Native acceptance harness

Run from the repository root with Node 24 and FFmpeg/ffprobe on PATH. Start `node --import tsx mobile/tests/server.mjs` and, in a separate process, a Python environment containing `requirements.txt` running `rtc.py`. Both bind only localhost. The fixed email code is `12345678`; production never includes the test Worker wrapper.

Build Release apps with `EXPO_PUBLIC_API_URL=http://127.0.0.1:4311` and `ASIDE_TEST_API=1`. On Android run `adb reverse tcp:4311 tcp:4311`. Use a fresh `example.com` test account for `voice.yaml`, so a restored answer cannot satisfy its assertion. Run one Maestro flow at a time per device. iOS system dialogs may expose a combined label (including the timestamp), so select the whole accessible control.

```sh
maestro --device DEVICE test -e EMAIL=fresh@example.com mobile/tests/smoke.yaml
maestro --device DEVICE test -e EMAIL=voice-fresh@example.com mobile/tests/voice.yaml
```

- `login.yaml`: sign in an already logged-out app.
- `restore.yaml`: after login to an account with a completed sample question, verify its complete conversation.
- `web-sync.mjs`: with Vite also running, sign into the same account using the website Cookie flow and test both conflict choices against real Worker checkpoint versions. It redirects only the isolated test browser's API requests to the fixture origin.
- `checkpoint.mjs EMAIL [POSITION_MS]`: read or deliberately change a fixture account's sample position to create a native conflict. It never prints the bearer token.
- `upload-android.yaml`: copy a generated WAV named `Aside-upload.wav` to `/sdcard/Download` first. iOS Files uses the app's Documents folder; open the **thumbnail** of the generated file.
- `background-start.yaml`: open the 31-minute silent AAC fixture and put the app in the background.
- `locked-start.yaml`: restart that fixture at its transcript anchor and lock the device. Retain the exact lock timestamp. Wait at least 30 real minutes, then inspect native media state / lock controls and reopen with `background-finish.yaml`. A playing icon alone is insufficient: verify actual position exceeds 30 minutes.
- `voice-autoresume.yaml` / `voice-capture.yaml`: focused follow-ups for an already signed-in app. Clear the existing hold by actively continuing before testing automatic continuation.

The fixture uses the actual production Worker, D1/R2, media decoder and analysis workflow. External transcription/model output is deterministic; the RTC peer transports real audio and data channels. These checks do not measure production model quality/latency, physical audio routes, Apple signing or distribution.

Native CI builds are a separate manually dispatched workflow. Its APK uses an ephemeral validation key and is **not** an update to distributed builds. Local delivery and EAS must retain their fixed private signing credentials.
