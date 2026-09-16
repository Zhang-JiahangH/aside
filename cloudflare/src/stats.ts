import type { Env } from "./env.js";

/**
 * `budgets` keys are `trial:<day>:<kind>:<owner>`, with `:global` and `:ip:<key>`
 * variants. `trial:` is 6 characters and the day is 10, so the kind starts at 18.
 */
const DAY = "substr(bucket,7,10)";
const KIND = "substr(substr(bucket,18),1,instr(substr(bucket,18),':')-1)";
const VISITOR_BUCKET =
  "bucket LIKE 'trial:%' AND bucket NOT LIKE '%:global' AND bucket NOT LIKE '%:ip:%'";

/**
 * Captures the counters that the scheduled cleanup is about to delete, plus
 * gauges that cannot be reconstructed later.
 *
 * Safe to run on every cron tick: each metric is an upsert keyed by (day,
 * metric), so repeating a tick rewrites the same value. Must run BEFORE the
 * cleanup that prunes `budgets`, and it only looks back as far as the rows the
 * cleanup still leaves in place, so nothing older is silently invented.
 */
export async function rollupDailyStats(env: Pick<Env, "DB">) {
  const today = new Date().toISOString().slice(0, 10);
  const upsert = (columns: string) =>
    `INSERT INTO daily_stats(day,metric,value) ${columns}
     ON CONFLICT(day,metric) DO UPDATE SET value=excluded.value`;
  await env.DB.batch([
    // One bucket per visitor per kind per day, so counting them counts visitors
    // who actually reached that paid path.
    env.DB.prepare(
      upsert(
        `SELECT ${DAY}, 'trial_visitors_' || ${KIND}, COUNT(*)
         FROM budgets WHERE ${VISITOR_BUCKET} GROUP BY 1, 2`,
      ),
    ),
    // The global bucket already holds the day's total for its kind.
    env.DB.prepare(
      upsert(
        `SELECT ${DAY}, 'trial_actions_' || ${KIND}, used
         FROM budgets WHERE bucket LIKE 'trial:%:global'`,
      ),
    ),
    // Gauges as of this tick. voice_usage has no timestamp, so its history only
    // exists if it is sampled like this.
    env.DB.prepare(
      upsert(
        `SELECT ?, 'users_total', COUNT(*) FROM users
         UNION ALL SELECT ?, 'episodes_total', COUNT(*) FROM episodes WHERE deleted_at IS NULL
         UNION ALL SELECT ?, 'voice_sessions_total', COUNT(*) FROM voice_usage
         UNION ALL SELECT ?, 'voice_seconds_total', COALESCE(SUM(seconds),0)
           FROM voice_usage WHERE true`,
        // The trailing WHERE is required, not decorative: after a compound
        // SELECT, SQLite cannot tell ON CONFLICT from a join's ON clause.
      ),
    ).bind(today, today, today, today),
    // Recomputed from a durable table, so it backfills every day it can see.
    env.DB.prepare(
      upsert(
        `SELECT date(created_at/1000,'unixepoch'), 'users_new', COUNT(*)
         FROM users GROUP BY 1`,
      ),
    ),
    // Outlives question_usage's 90-day retention.
    env.DB.prepare(
      upsert(
        `SELECT day, 'questions', COUNT(*) FROM question_usage GROUP BY 1`,
      ),
    ),
    env.DB.prepare(
      upsert(
        `SELECT day, 'question_trial_questions', COUNT(*)
         FROM question_usage WHERE account_id IS NULL GROUP BY 1`,
      ),
    ),
    env.DB.prepare(
      upsert(
        `SELECT day, 'question_output_tokens', COALESCE(SUM(output_tokens),0)
         FROM question_usage GROUP BY 1`,
      ),
    ),
    env.DB.prepare(
      upsert(
        `SELECT day, 'question_reasoning_tokens', COALESCE(SUM(reasoning_tokens),0)
         FROM question_usage GROUP BY 1`,
      ),
    ),
  ]);
}

/** Long rows for the window, newest day first. */
export async function readDailyStats(env: Pick<Env, "DB">, days: number) {
  const since = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 10);
  const { results } = await env.DB.prepare(
    "SELECT day, metric, value FROM daily_stats WHERE day>=? ORDER BY day DESC, metric",
  )
    .bind(since)
    .all<{ day: string; metric: string; value: number }>();
  return results;
}
