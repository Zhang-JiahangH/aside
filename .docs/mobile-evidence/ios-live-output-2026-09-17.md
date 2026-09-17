# iOS hold-to-talk output diagnosis — 2026-09-17

## What failed

The user's physical iPhone 14 Plus (Aside Dev build 11) successfully transcribed a spoken question. The production backend returned `action: answer`, but no Live output transcript or audio-start event followed. HTTP 200 alone had incorrectly been treated as sufficient service coverage.

Native Live negotiated `recvonly`, with no input audio. GPT-Live requires an active input media timeline, including silence, to process injected context and produce speech. The browser already supplied a disabled/silent input track. The old local RTC fixture emitted an answer directly on commentary, so it falsely accepted the native transport.

Reference: [OpenAI — Managing GPT-Live sessions, “Greet before the caller speaks”](https://developers.openai.com/api/docs/guides/live-conversations#greet-before-the-caller-speaks).

## Real-service evidence on the physical iPhone

All calls used the installed app's existing authorized account and `https://asidefm.com`. No provider keys or bearer tokens were exported. Diagnostic builds were temporary; the normal release removes their code.

| Probe | Observation |
|---|---|
| Build 12, original recvonly connection | `session.started` arrived; no transcript or inbound audio packets. Sending `session.input_audio.mute` did not recover output. The app reported closure through the backend when the supplier did not acknowledge closing. |
| Build 13, native zero-PCM input track | First output transcript arrived 0.60 s after commentary. “测试成功。” was generated. 610 inbound audio packets, nonzero audio energy; `session.closed` acknowledged. |
| Build 14, one prerecorded M4A through real ASR → question backend → native Live | ASR completed at 4.03 s; a substantive backend answer arrived at 6.79 s; first output transcript at 7.29 s. 1001 inbound packets, nonzero audio energy, no lost packets. `session.closed` at 23.49 s. |

The full service probe used a prerecorded sentence, not a newly spoken user utterance. The earlier device trace separately establishes successful physical microphone capture and ASR. These observations do not constitute a user-observed end-to-end hold/release acceptance of the final build.

The pipeline probe also exposed answer-language drift: English input/backend text was spoken in Chinese because NativeVoice omitted the latest actual user utterance from Live context. NativeVoice now supplies the recognized utterance and the language instructions before invoking the backend, with a regression assertion. This final language adjustment has local coverage; it was not another paid production replay.

## Changes

- iOS uses a custom WebRTC audio device: AVAudioEngine renders remote PCM and feeds only zero PCM as input. It never creates a microphone input node. Expo alone records while holding the talk button.
- The existing audio coordinator stops answer rendering before recording/podcast transitions. Native route removal, call interruption, and backgrounding stop rendering; route/call events cancel the JS question and retain the paused anchor.
- Repeated holds share the in-flight Live connection. A regression reproduced two peers before this change and one afterward.
- Transcription progress survives early Live startup; empty ASR results fail explicitly; the startup deadline includes HTTP negotiation.
- Answer-end detection uses measured RMS, so Opus comfort noise cannot keep the answer active indefinitely. Missing reliable stats retain manual resumption.
- The RTC fixture now waits for incoming media before producing an answer. A local real-WebRTC test checks both recvonly failure and synthetic-silence success.

## Validation

- `npm run check`: passed (TypeScript, shared-module boundaries, Cloudflare and mobile checks).
- `npm test`: 252 passed, 0 failed, with FFmpeg/ffprobe on PATH.
- `mobile/tests/test_rtc.py`: 2 passed, using actual local WebRTC transport and synthetic input.
- Release iPhone and iOS simulator builds: compiled successfully.
- Final device build 15: embedded config `https://asidefm.com`, `testApi=false`, OTA disabled; no temporary diagnostic strings in the bundled JS.
- Physical iPhone: signature verification succeeded; devicectl confirms Aside Dev 0.1.0 **build 15** installed and launched, with existing app data preserved.
- iPhone 16 Pro simulator: fresh-account `voice.yaml` passed (native hold/release, new answer visible, manual continuation, background playback restoration).
- `voice-autoresume.yaml` passed. Checkpoint changed from no committed conversation to a newly completed user/assistant pair, independently verifying the answer was new. [Screenshot](../mobile-screenshots/ios-live-natural-resume-2026-09-17.png).
- Test-environment correction: the first unsigned simulator build could not access SecureStore. Rebuilt with Xcode `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`; the completed flows above use that signed test package. A separate fixture-account probe invalidated an in-progress test code; final acceptance used a fresh account with no concurrent login probe.
- `background-question.yaml` and `cancel-capture.yaml`: both passed. Returning to foreground leaves playback paused; completed checkpoint history remains exactly the prior user/assistant pair (no cancelled partial turn).

Scope: this change fixes iOS Live audio. It does not establish Android voice acceptance, physical incoming-call/headphone acceptance, or completed final user hold/release acceptance. No Cloudflare deployment or Android distribution was performed for this change.
