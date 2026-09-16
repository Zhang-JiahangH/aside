---
name: aside-usage
description: Query Aside's question-cost ledger (model tokens, reasoning tokens, and whether fast mode actually served) from the deployed Worker's admin endpoint. Use when asked how much the backend question model is costing, whether priority/fast mode is being downgraded, how much anonymous trial traffic spends, or to inspect per-day or per-account question usage on asidefm.com.
---

# Aside question-cost ledger

Every answered or failed question writes one row to D1 (`question_usage`), recording
the model, the service tier that **actually** served each round, and the token
counts the fast-mode premium applies to. This skill reads the rollups back.

## Run it

```bash
node scripts/admin-usage.mjs                 # last 7 days, production
node scripts/admin-usage.mjs --days 30       # longer window (max 90)
node scripts/admin-usage.mjs --json          # raw JSON for further processing
node scripts/admin-usage.mjs --url http://localhost:8787   # local wrangler dev
```

The script reads `ASIDE_ADMIN_KEY` from the environment, then from `.env`, then
from `.dev.vars` (all gitignored). It sends the key in the `x-admin-key` header,
never in the URL.

## Reading the output

- **Served tier** is the answer to "did fast mode engage". The endpoint reports
  the tier that served the rounds, not the one requested. A value containing
  `default` means Cloudflare/OpenAI downgraded it to standard speed; `priority`
  means fast mode served it. `priority+default` means one question was
  downgraded partway through its tool loop.
- **Audience** splits anonymous trial traffic (`trial`) from signed-in accounts
  (`account`). Fast mode costs roughly twice the standard per-token rate, so
  this row is what decides whether the trial allowance stays affordable.
- **reasoning** is the share of output tokens spent thinking rather than
  answering. It is the number that justifies the 10000-token output budget; if
  it sits far below that, the budget has slack, and if questions start failing
  with `Model reply incomplete (max_output_tokens)`, it does not.
- Spoken answers are capped by the dialogue policy at ~350 Chinese characters,
  so a large `out` with a small `reasoning` is unusual and worth investigating.

## Daily snapshots

The report's last table comes from `daily_stats`, written by the `*/5 * * * *`
cron before it prunes the counters it reads. Without it those numbers are gone:
`budgets` keeps trial counters for two days and `voice_usage` has no timestamp
at all, so visitor history cannot be reconstructed after the fact.

- `trial_visitors_<kind>` — distinct visitors who reached that paid path that
  day (one `budgets` bucket exists per visitor per kind per day). This is the
  closest thing to "how many people tried it", and it counts only visitors who
  actually asked or spoke, not everyone who loaded the page.
- `trial_actions_<kind>` — that day's total for the kind, from the global bucket.
- `users_new` — accounts created that day; `users_total`, `episodes_total`,
  `voice_sessions_total`, `voice_seconds_total` are gauges sampled on the tick.
- `questions`, `question_trial_questions`, `question_output_tokens`,
  `question_reasoning_tokens` — daily cost, kept past `question_usage`'s 90 days.

There is still no page-view or unique-visitor count: anonymous visitors are not
logged until they consume a quota. Cloudflare Web Analytics would cover that,
and is not enabled.

## Troubleshooting

| Result | Meaning |
| --- | --- |
| `401` | The local key does not match the Worker secret. |
| `404` | `ADMIN_KEY` is not set on the Worker, so the route is deliberately unmounted. |
| Empty rollups | No questions in the window, or the deploy predates migration `0006`. |

## Setup (once)

```bash
# 1. generate a key
openssl rand -base64 32

# 2. store it locally (gitignored)
echo "ASIDE_ADMIN_KEY=<key>" >> .env

# 3. give the Worker the same value
npx wrangler secret put ADMIN_KEY --config wrangler.production.jsonc

# 4. apply the ledger migration
npm run db:cloudflare:production
```

Rotating the key means repeating steps 1–3; requests with the old key start
failing as soon as the secret is replaced.
