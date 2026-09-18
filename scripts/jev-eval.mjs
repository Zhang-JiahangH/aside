// Opt-in offline evaluation of Jev (through OpenRouter's alpha Decisions
// endpoint) as a fast admission classifier for heard utterances: accuracy per
// decision and language, confidence cut-offs, latency and a concurrency burst.
// The question mirrors backend/src/jev-shadow.ts; keep the two in step.
//   npm run eval:jev        (reads OPEN_ROUTER_API_KEY from .env; costs cents)

const key = process.env.OPEN_ROUTER_API_KEY;
if (!key) throw Error("OPEN_ROUTER_API_KEY missing");
const MODEL = "typesafe/jev-1.13";
const URL_ = "https://openrouter.ai/api/alpha/decisions";

// Gold labels use Aside's decision space.
// ignore: not addressed to the player (bystander talk, self-talk, noise words)
// wait: addressed but clearly unfinished
// pause / resume / control (rate, seek, volume) / question (needs an answer)
const P = "playing"; // podcast playing, no conversation open
const A = "answered"; // podcast paused, assistant just finished an answer
const cases = [
  // --- English, playing
  [P, "Hold on. What did he mean by 'spiritual victory' just now", "question"],
  [P, "Wait, who is she talking about?", "question"],
  [P, "Can you explain that last part?", "question"],
  [P, "What year did that happen?", "question"],
  [P, "I don't get why that matters, can you explain?", "question"],
  [P, "Is that actually true?", "question"],
  [P, "Pause", "pause"],
  [P, "Hold on a second", "pause"],
  [P, "Wait", "pause"],
  [P, "Stop for a moment please", "pause"],
  [P, "Can you slow it down a bit", "control"],
  [P, "Play it faster", "control"],
  [P, "Go back thirty seconds", "control"],
  [P, "Skip ahead a minute", "control"],
  [P, "Turn the volume up", "control"],
  [P, "Honey, what should we have for dinner?", "ignore"],
  [P, "No, don't touch that, put it down", "ignore"],
  [P, "Yeah I'll call you back in five minutes", "ignore"],
  [P, "Did you feed the cat this morning?", "ignore"],
  [P, "Uh huh", "ignore"],
  [P, "Hmm", "ignore"],
  [P, "Okay so the meeting is at three, right?", "ignore"],
  [P, "Can you pass me the salt", "ignore"],
  [P, "What time is your flight tomorrow?", "ignore"],
  [P, "Wait, what did he", "wait"],
  [P, "Can you explain the", "wait"],
  [P, "So I was wondering if", "wait"],
  // --- English, after an answer
  [A, "OK, go on", "resume"],
  [A, "You can continue now", "resume"],
  [A, "Back to the podcast", "resume"],
  [A, "Resume please", "resume"],
  [A, "Thanks, keep playing", "resume"],
  [A, "Tell me more about that", "question"],
  [A, "And what happened after that?", "question"],
  [A, "Why?", "question"],
  [A, "Continue explaining that point", "question"],
  [A, "Sorry, one sec, someone's at the door", "ignore"],
  [A, "Mom, I'm listening to something, give me a minute", "ignore"],
  // --- Chinese, playing
  [P, "等一下,他刚才说的那个精神胜利法到底是什么意思", "question"],
  [P, "他刚才说的那个精神胜利法到底是什么意思", "question"],
  [P, "这个人是谁啊", "question"],
  [P, "刚才那句话什么意思,解释一下", "question"],
  [P, "这是哪一年的事", "question"],
  [P, "为什么这么说", "question"],
  [P, "他说的对吗", "question"],
  [P, "等一下", "pause"],
  [P, "暂停", "pause"],
  [P, "停一下", "pause"],
  [P, "先停", "pause"],
  [P, "等等", "pause"],
  [P, "放慢一点", "control"],
  [P, "快一点播", "control"],
  [P, "倒回去三十秒", "control"],
  [P, "往前跳一分钟", "control"],
  [P, "声音大一点", "control"],
  [P, "晚上吃什么?要不点个外卖吧", "ignore"],
  [P, "你作业写完了没有", "ignore"],
  [P, "喂,我一会儿给你回电话", "ignore"],
  [P, "别碰那个,放下", "ignore"],
  [P, "嗯", "ignore"],
  [P, "哦", "ignore"],
  [P, "明天几点的飞机", "ignore"],
  [P, "帮我把那个杯子拿过来", "ignore"],
  [P, "今天天气不错啊", "ignore"],
  [P, "等一下,他刚才说的那个", "wait"],
  [P, "我想问一下就是", "wait"],
  [P, "那个什么来着", "wait"],
  // --- Chinese, after an answer
  [A, "好吧,继续吧", "resume"],
  [A, "可以继续播了", "resume"],
  [A, "接着放吧", "resume"],
  [A, "继续", "resume"],
  [A, "好了,谢谢,继续听", "resume"],
  [A, "再讲详细一点", "question"],
  [A, "然后呢", "question"],
  [A, "为什么", "question"],
  [A, "继续讲刚才那个点", "question"],
  [A, "等会儿,有人敲门", "ignore"],
  [A, "妈,我在听东西,等我一下", "ignore"],
];

const question = {
  type: "choice",
  instructions: {
    question:
      "A podcast player app with a voice assistant hears speech through an open microphone. What should the app do with this utterance?",
    focus:
      "Decide from the utterance and the player state. People nearby also talk to each other; the app must not react to speech that is not meant for it. The utterance may be in Chinese or English.",
  },
  criteria: {
    ignore: {
      what: "Not addressed to the app: talk between people in the room, a phone call, self-talk, filler sounds like 'hmm', 'uh huh', '嗯', '哦'.",
      examples: ["Honey, what should we have for dinner?", "你作业写完了没有", "Hmm"],
    },
    wait: {
      what: "Addressed to the app but the sentence is clearly cut off mid-thought; more words are needed to know what is asked.",
      examples: ["Can you explain the", "我想问一下就是"],
    },
    pause: {
      what: "Asks only to pause or stop playback, with no question attached.",
      examples: ["Wait", "Hold on", "等一下", "暂停"],
    },
    resume: {
      what: "Asks to continue or return to the podcast playback.",
      not_for: "Asking the assistant to continue its explanation.",
      examples: ["OK, go on", "Back to the podcast", "继续", "接着放吧"],
    },
    control: {
      what: "Asks for another playback change: speed, seeking backward or forward, volume.",
      examples: ["Slow it down", "Go back thirty seconds", "声音大一点"],
    },
    question: {
      what: "Asks the assistant something or wants an explanation or more detail, including follow-ups. A leading 'wait' or '等一下' before a question is still a question.",
      examples: ["What did he mean by that?", "然后呢", "Continue explaining that point"],
    },
  },
};

const stateFor = (ctx, text) =>
  JSON.stringify({
    player:
      ctx === P
        ? { podcast: "playing", conversation: "none" }
        : { podcast: "paused for a conversation", assistant: "just finished answering the listener" },
    utterance: text,
  });

async function decide(ctx, text) {
  const started = performance.now();
  const response = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state: stateFor(ctx, text), questions: { action: question } }),
    signal: AbortSignal.timeout(10000),
  });
  const ms = performance.now() - started;
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ms, answer: body.answers?.action, usage: body.usage, error: body.error };
}

// Warm the connection so latency reflects a keep-alive client, as a Worker would hold.
await decide(P, "warm up");
const rows = [];
for (const [ctx, text, gold] of cases) {
  try {
    const r = await decide(ctx, text);
    rows.push({ ctx, text, gold, ...r, got: r.answer?.choice, confidence: r.answer?.confidence, p: r.answer?.probabilities?.[r.answer?.choice] });
  } catch (error) {
    rows.push({ ctx, text, gold, status: 0, ms: NaN, error: String(error) });
  }
}
// Burst: 20 concurrent, to see behaviour under parallel load.
const burstStart = performance.now();
const burst = await Promise.all(
  Array.from({ length: 20 }, (_, i) => decide(P, cases[i][1]).catch((e) => ({ status: 0, ms: NaN, error: String(e) }))),
);
const burstMs = performance.now() - burstStart;

const ok = rows.filter((r) => r.status === 200 && r.got);
const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
const q = (p) => Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]);
const right = ok.filter((r) => r.got === r.gold);
const lang = (r) => (/[㐀-鿿]/.test(r.text) ? "zh" : "en");
const acc = (set) => `${set.filter((r) => r.got === r.gold).length}/${set.length}`;
console.log(`requests ${rows.length}, ok ${ok.length}, failed ${rows.length - ok.length}`);
console.log(`latency ms  p50 ${q(0.5)}  p90 ${q(0.9)}  p95 ${q(0.95)}  max ${Math.round(lat.at(-1))}  min ${Math.round(lat[0])}`);
console.log(`accuracy overall ${acc(ok)}  en ${acc(ok.filter((r) => lang(r) === "en"))}  zh ${acc(ok.filter((r) => lang(r) === "zh"))}`);
for (const label of ["ignore", "wait", "pause", "resume", "control", "question"])
  console.log(`  ${label.padEnd(9)} ${acc(ok.filter((r) => r.gold === label))}`);
for (const t of [0.6, 0.7, 0.8, 0.9]) {
  const kept = ok.filter((r) => r.confidence >= t);
  console.log(`confidence >= ${t}: kept ${kept.length}/${ok.length}, accuracy ${acc(kept)}`);
}
console.log("\nmisses:");
for (const r of ok.filter((r) => r.got !== r.gold))
  console.log(`  [${r.ctx}] ${JSON.stringify(r.text)} gold=${r.gold} got=${r.got} conf=${r.confidence?.toFixed(2)} p=${r.p?.toFixed(2)}`);
const bl = burst.filter((b) => b.status === 200).map((b) => b.ms).sort((a, b) => a - b);
console.log(`\nburst of 20 concurrent: ok ${bl.length}/20, statuses ${[...new Set(burst.map((b) => b.status))]}, wall ${Math.round(burstMs)}ms, slowest ${Math.round(bl.at(-1) ?? NaN)}ms`);
const tokens = ok.reduce((n, r) => n + (r.usage?.input_tokens ?? 0), 0);
console.log(`avg input tokens ${Math.round(tokens / ok.length)}, total cost $${ok.reduce((n, r) => n + (r.usage?.cost ?? 0), 0).toFixed(5)}`);
