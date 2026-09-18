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

Feature branch: `codex/continuous-mobile-voice`. PR: https://github.com/qiz029/aside/pull/29.
No Web source files changed. Shared spoken continuation is opt-in (`verified`);
Web retains its explicit policy. The branch includes compatibility PR #28.

### Native conversation

Implemented continuous microphone capture, local speech activity and volume ducking,
authenticated NDJSON control/acknowledgements, bounded PCM admission queues, paced
captions, verified 3/8/manual continuation, follow-up anchors, connected typed
answers, interruption cleanup, account-bound orphan-session recovery, input meters,
conversation reset and playback-options UI. Manual AAC capture remains available.
Background closes conversation capture and resets microphone consent; subsequent
Play can resume the episode without opening the microphone. Sign-out removes this
account's recovery credential.

The C and Java native queues pass identical sample-trace tests. Extended simulator
runs on both platforms observed actual incoming RTP and rendered output, verified a
drained queue before the continuation timer, ignored irrelevant speech, and retained
one anchor across follow-ups. There was no podcast/answer overlap. Long answers
waited 8.166 seconds on iOS and 8.248 seconds on Android. iOS recovered its own
force-quit session in 2.231 seconds without creating another Live session.
See `mobile-evidence/continuous-native.json`.

These are native transport/coordination results with deterministic external model
responses. They do not measure physical microphone quality, acoustic echo,
Bluetooth routing or production-model accuracy.

### Interaction and visual review

Light/dark, Chinese/English and keyboard/settings flows passed on both platforms.
iPhone SE at the extra-extra-extra-large text setting was inspected for clipping;
its player, composer and settings remained operable. Screenshots are in
`mobile-screenshots/continuous-*`.

Long-history review caught two distinct issues: programmatic iOS scrolling could
turn off following, and FlatList's estimated end position could hide the newest
variable-height reply. The conversation now renders newest-first in an inverted
list, so the latest message is at exact offset zero. User scrolling can still stop
following. A unique-question flow checks the partial stream, empty composer and
completion of that request; actual screenshots are also inspected because native
accessibility alone can expose text outside the visible viewport.

On the final iOS fixture, manual AAC recording/transcription and native answer
playback passed; manual continuation remained paused beyond ten seconds and
resumed only on Continue. Denied permission showed the Settings recovery action.
Backgrounding continuous mode closed it, and subsequent Play kept the microphone
off. Slide cancellation and Android final interaction checks are recorded below
when complete.

### Verification

- 360 unit/application tests passed, including native C/Java queues, late events,
  cancellation, account isolation, request deadlines and checkpoint versions.
- TypeScript and module-boundary checks passed.
- Web regression: one complete run passed all 66 scenarios (3.3 minutes). Earlier
  startup timing flakes passed when rerun; no Web fix was introduced.
- Cloudflare service regression passed in CI. Read-only production checks passed
  for mobile authentication routing, Bearer validation and website Origin checks.
- Final release and duration evidence is still being completed below.

Local acceptance binaries require an explicit loopback test flag and must never be
distributed. Release candidates use `https://asidefm.com`, test flag off, embedded
JS and no OTA updates. Android retains the existing release signing key.
Ad Hoc/TestFlight configuration remains available but paid Apple signing acceptance
is pending the user's account approval.

### Remaining acceptance evidence

- Diagnose and resolve the physical continuous-question failure, then verify one
  bounded real end-to-end conversation and record its usage.
- Install a normal iPhone release without diagnostics and publish the corresponding
  Android candidate after that fix; keep PR #29 in draft until then.
- Physical headset/call handling and the visible iOS lock-screen card need device
  confirmation. The current simulator's system commands work (see below).

### Physical continuous-voice acceptance blocker

iPhone build 27 (source `8bc7f96`, production API) was installed. A short Chinese
definition question lowers programme volume but does not pause or answer. The
production sideband observes input transcript fragments but no Responses
delegation or backend question execution for that attempt. The logged character
count describes only the first fragment, not the complete utterance.

Diagnostic build 28 is signed and installed on the same physical iPhone, using
`https://asidefm.com` with the test flag off. The user reproduced intermittent
failure with the iPhone's built-in speaker. One trace recognized the complete
question, admitted a backend answer and rendered native PCM; that answer still
explained the wrong term. Another trace contained incomplete recognized phrases
and repeated `wait_for_input` results without an admitted answer. This is not a
successful release acceptance.
Temporary device-local instrumentation records transcript events,
control events and native/RTC counters; no login credential is recorded. This
diagnostic source is retained only in `/tmp` and removed from the repository
after bundling. The cause and final physical acceptance remain unverified. Do not
mark continuous voice ready or distribute build 28.

### Context-flood reproduction and mobile-only correction

The build-28 trace exposed duplicate programme-context appends at native player
status cadence. During a gap between transcript passages, `current?.startMs` was
`undefined` while the remembered sentinel was `-1`, so every 250 ms tick appended
the same programme text to Live. The backend already maintains Responses'
transcript window from acknowledged player state.

A new runtime regression reproduced 20 duplicate appends during a five-second
gap. Mobile now opts into `liveContext: "server"`: automatic Responses sessions
use that single context owner and still synchronize playhead, seek and pause.
Manual context and Web's default client policy retain their existing behavior.
The reproduction failed before this change and passes after it. All 380 root
tests, type checks and the merged Cloudflare sideband regression pass.

Upstream PR #31 has been merged into this branch. Its missed-delegation fallback
is visible in production, including the unsuccessful physical trace. Adding a
fallback alone therefore does not establish that the full question was heard or
answered. Removing duplicate context is a verified defect correction; its effect
on physical speech recognition and answer quality still needs a bounded device
comparison. Do not treat it as proof that the intermittent failure is fixed.

### Additional fixture evidence

Both platforms completed 30 actual minutes of background native playback: iOS
1,802.17 seconds elapsed with native position 1,805,762.79 ms; Android 1,802.30
seconds elapsed with native position 1,808,758 ms. These duration runs used build
18, with unchanged native programme playback. Android's system media control
subsequently paused playback. On final iOS fixture build 26, operating-system
media commands also paused, played and paused the native AVPlayer; Now Playing
metadata reported rate 0, 1 and 0 with the correct episode. After the play event
settled, the app reported `playing` and its microphone remained off. These are
actual system-command results, not app-button simulations. The simulator does
not render the visible lock-screen card; the earlier independent plain AVPlayer
probe had the same limitation. Card appearance remains a physical-device check.

After merging upstream spoken-answer history ownership, iOS and Android build 26
passed the local native continuous-conversation flow. Android EAS build 14 has
been downloaded, its fixed production certificate verified, and it installed
over the previous production package while retaining app data. Physical voice
acceptance above remains the release blocker.

Android build 26 also passed the unique-question streaming flow: partial text,
cleared composer and complete latest reply. The screenshot was visually checked
to confirm both this question and this answer were inside the viewport.

Android build 26 manual AAC capture, transcription, native answer playback and
manual continuation also passed: playback remained paused beyond ten seconds and
resumed on Continue. These checks use the local fixture.

EAS build 14 passed read-only production UI checks: actual public catalogue and
transcript loaded, no fixture episode appeared, and Account opened without the
test-environment marker. No email or paid model request was made by this check.

Condensed artifact hashes, signing certificate, native duration measurements and
system-command traces: [release evidence](mobile-evidence/continuous-release-2026-09-17.json).
