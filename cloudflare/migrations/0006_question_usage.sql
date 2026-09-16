-- Per-question cost ledger. One row per answered (or failed) question, so the
-- premium service tier and reasoning budget can be reconciled after the fact.
-- `account_id` is NULL for anonymous trial traffic, which is the split that
-- decides whether the trial's allowance is affordable.
CREATE TABLE question_usage (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  account_id TEXT,
  episode_id TEXT NOT NULL,
  model TEXT,
  -- Tiers that actually served the rounds, joined with "+": a value containing
  -- "default" means fast mode was downgraded for at least one round.
  tiers TEXT NOT NULL,
  rounds INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  cached_input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL
);
CREATE INDEX question_usage_day ON question_usage(day);
CREATE INDEX question_usage_ts ON question_usage(ts);
