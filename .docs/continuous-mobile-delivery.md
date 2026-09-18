# Continuous conversation delivery

Goal: close the native gaps described in the Aside conversation-loop artifact,
then deliver installed iOS and distributable Android candidates for user acceptance.
The compatibility PR #28 is a baseline, not completion of this goal.
User scope correction: do not change Web behavior. Shared runtime extensions must
be opt-in for mobile and preserve the existing Web policy and tests.

## Required acceptance evidence

- [ ] iOS and Android: enable automatic mode once, stream microphone input while
  the podcast plays, show input activity and a clear connection state.
- [ ] Speech ducks the podcast promptly; accepted conversation fades and pauses;
  irrelevant input restores volume without committing a conversation.
- [ ] Continuous Responses delegation uses authenticated control streaming and
  execution acknowledgements; late events cannot affect a replacement session.
- [ ] Buffer answer PCM before admission; play the prefix once, release captions
  with audible output, bound buffering, and surface overflow/errors.
- [ ] Interrupt an answer and ask follow-ups without another hold gesture; retain
  one interruption anchor and preserve submitted/heard conversation history.
- [ ] iOS and Android: completed spoken answers enter the configured 3/8-second
  follow-up countdown; long answers wait at least eight seconds. Backend work,
  unplayed audio, thinking gaps, new speech, drafts and manual hold prevent resume.
  Missing reliable completion evidence requires an explicit, visible Continue.
- [ ] Resume at the semantic anchor, keep continuous input alive, and support the
  next conversation. Manual pause/off/background capture closes the microphone.
- [ ] Text questions clear immediately and stream; when voice is connected,
  speak the answer. Listen-only text questions require no new voice connection.
- [ ] Preserve manual hold/release/slide-cancel/30-second limit and fix Android's
  missing media input clock. Include new-conversation reset and input-level UI.
- [ ] Background podcast playback, lock controls, permission denial, headset/call
  interruption, expiry/reconnect, account isolation and checkpoint sync regressions.
- [ ] Native UI review on both simulators: clear header/content/control hierarchy,
  legible states, accessible controls, keyboard, dark/light and Chinese/English.
- [ ] Unit/runtime, native PCM, browser, Cloudflare, simulator and CI evidence;
  one bounded real end-to-end session after fixture validation, with cost recorded.
- [ ] Production backend deployed only as needed; production-configured iPhone local
  install, fixed-key Android APK/EAS distribution, branch and PR ready for acceptance.

## Implementation notes

Do not apply manual-mode idle cleanup to continuous listening. The current upstream
unconditional spoken-answer hold remains Web's default. Mobile opts into
completion-aware scheduling. GPT-Live has independent backend, caption and audio streams;
backend completion alone cannot establish that the listener heard the answer.

No item is accepted merely because a mock returns a successful response. Native
capture, transport, actual queued output, saved checkpoints and installed artifacts
need their own evidence. Paid calls are reserved for the final bounded smoke.

## Implementation and current evidence — 2026-09-17

Branch: `codex/continuous-mobile-voice`, based on compatibility PR #28.
No Web source files changed. Shared spoken continuation is opt-in (`verified`);
Web retains its existing explicit policy.

Implemented native continuous microphone capture, local VAD/volume ducking,
authenticated NDJSON control/acknowledgements, PCM admission queues, paced captions,
completion-verified 3/8/manual continuation, follow-up anchors, connected typed
answers, interruption cleanup, account-bound orphan-session recovery, input meters,
conversation reset and playback-options UI. Manual AAC capture remains available.

The native queue has matching C and Java sample-trace tests. Actual simulator runs
on both platforms observed incoming RTP and rendered output, verified a drained
queue before a three-second wait, and resumed from the semantic anchor while Live
remained connected. No podcast/answer overlap occurred. iOS resumed at 80.080s from
an 80.000s anchor; Android resumed at 0.115s from a 0.000s anchor. These are fixture
transport results, not claims about physical microphone or production-model quality.

Standard-size UI flows passed on both platforms: keyboard keeps Send visible,
settings fit, 3/8/manual choices work, and Chinese/English render correctly.
Screenshots are under `mobile-screenshots/continuous-*`. Later long-history testing
caught automatic scrolling being mistaken for manual scrolling; the fix is in the
current candidate and is being rechecked.

Current acceptance work includes multi-turn/long-answer native runs, manual-mode
regression, small-screen/accessibility review, background playback, one bounded
production smoke, installable release artifacts, and PR/CI. The checklist above
remains deliberately incomplete until this evidence is recorded.

No paid model or real email calls have been made during this feature work so far.
Local test builds use an explicit loopback flag and must never be distributed.
Production candidates are rebuilt against `https://asidefm.com` with that flag off.
