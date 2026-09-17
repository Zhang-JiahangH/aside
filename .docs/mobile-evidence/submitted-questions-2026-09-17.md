# Submitted questions survive an interrupted answer

## Defect and change

Manual ASR text was provisional until the backend accepted its intent. The
checkpoint was committed only when answer audio ended; continuing playback,
starting a follow-up, a connection error or backgrounding rolled the user message
back along with the unfinished reply. Native ASR also withheld its result until
the Live connection was ready.

Explicit manual and typed messages now enter visible, durable history as soon as
they are submitted/recognized. Native ASR publishes the recognized text before
Live readiness, while backend question dispatch still waits for the connection.
Both callbacks share one message ID. Cancelling an answer keeps its submitted
question; cancelling an unsent recording still adds nothing. Automatic ambient
speech retains its existing provisional classification behavior.

## Verification

- `npm run check`: passed (root, module boundaries, Cloudflare and mobile types).
- `npm test`: 257 passed. Added regressions for early ASR visibility/checkpoint
  publication, connection failure, interrupted answer, follow-up replacement and
  manual ignore/wait results. Updated typed-message/background expectations;
  partial assistant previews remain excluded. Native late/cancelled ASR stays
  excluded and connection timeout does not trigger a question request.
- Playwright `tests/browser/listening-controls.spec.ts`: 3 passed.
- iPhone 16 Pro simulator, iOS 18.3, signed Release build 16:
  `mobile/tests/voice-history.yaml` passed against a real local Worker/D1/R2,
  native recorder and WebRTC transport with synthetic ASR/model output.
  `QUESTION_DELAY_MS=15000` holds the answer while the UI shows the user's bubble.
  Backgrounding aborts the answer, and a full app stop/relaunch restores only the
  submitted user message. Screenshots were visually inspected.
- Independent Worker checkpoint after the strict UI flow: version 9, position 0,
  history `[{role: "user", text: "Question"}]`. No partial or late assistant reply.
- `mobile/tests/cancel-capture.yaml` passed; a separate checkpoint read confirmed
  that sliding out to cancel added no message.
- A following completed voice turn produced exactly three durable messages:
  the original interrupted question, the new question, and `A short answer`, with
  distinct IDs. Its auto-resume Maestro `Pause` assertion returned after about
  5 seconds despite a configured 20-second timeout, while the screenshot showed
  `Resuming in 2s`. A subsequent screenshot confirmed native playback advancing
  with the Pause control. This supplemental flow is not counted as a passing
  automated auto-resume test.

The first UI assertion matched the composer's `Question` accessibility label too
early. It was tightened to require a user-role bubble (`^You$`), absence of the
empty-conversation view and absence of the answer. The fixture checkpoint was
reset and the complete flow rerun. The linked screenshots are from that rerun.

## Installed artifact and limits

`com.asidefm.app.dev` 0.1.0 build 16 was signed, verified with `codesign --verify
--deep --strict`, and installed over build 15 on the connected iPhone 14 Plus.
`devicectl` confirmed installed bundle version 16. The bundled config points to
`https://asidefm.com`, with `testApi: false`; the embedded JS includes the early
recognition callback. Existing app data was preserved.

The phone was locked, so OS launch was denied until the user unlocks it. This
change's recognition/persistence regression was verified in the simulator; no
new paid model or transcription calls were made. No backend deployment or new
Android package was needed for this iPhone fix. Previously discarded unsaved
messages cannot be reconstructed by this change.

## Screenshots

- [Recognized question while the answer is pending](../mobile-screenshots/ios-question-before-answer-2026-09-17.png)
- [User message restored after restarting](../mobile-screenshots/ios-question-restored-2026-09-17.png)
