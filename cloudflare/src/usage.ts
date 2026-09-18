import { z } from "zod";
import type { QuestionTelemetry } from "../../backend/src/question-service.js";
import { jevModel, type ShadowRecord } from "../../backend/src/jev-shadow.js";
import type { Env } from "./env.js";
import { HttpError, json } from "./http.js";
import { readDailyStats } from "./stats.js";

/** Rows older than this are dropped by the scheduled cleanup. */
export const RETENTION_DAYS = 90;

/**
 * Records what one question spent. Never blocks or fails an answer: the ledger
 * is for reconciliation, so a D1 hiccup costs a row, not a reply.
 */
/** One shadow comparison. Evidence only, so a failed write is dropped silently. */
export async function recordJevShadow(
  env: Pick<Env, "DB">,
  entry: ShadowRecord,
) {
  const now = new Date();
  try {
    await env.DB.prepare(
      `INSERT INTO jev_shadow(id,ts,day,model,status,jev_ms,jev,confidence,backend,backend_ms,agree,characters,han,was_playing)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        crypto.randomUUID(),
        now.getTime(),
        now.toISOString().slice(0, 10),
        jevModel,
        entry.status,
        Math.round(entry.jevMs),
        entry.jev ?? null,
        entry.confidence ?? null,
        entry.backend ?? null,
        entry.backendMs === undefined ? null : Math.round(entry.backendMs),
        entry.jev && entry.backend ? Number(entry.jev === entry.backend) : null,
        entry.characters,
        Number(entry.han),
        Number(entry.wasPlaying),
      )
      .run();
  } catch (error) {
    console.warn("Aside Jev shadow record dropped", { error: String(error) });
  }
}
export async function recordQuestionUsage(
  env: Pick<Env, "DB">,
  entry: {
    owner: string;
    accountId: string | null;
    episodeId: string;
    totals: QuestionTelemetry;
  },
) {
  const { totals } = entry;
  const now = new Date();
  try {
    await env.DB.prepare(
      `INSERT INTO question_usage(id,ts,day,owner_id,account_id,episode_id,model,tiers,rounds,
         input_tokens,cached_input_tokens,output_tokens,reasoning_tokens)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        crypto.randomUUID(),
        now.getTime(),
        now.toISOString().slice(0, 10),
        entry.owner,
        entry.accountId,
        entry.episodeId,
        totals.model ?? null,
        [...new Set(totals.tiers)].join("+") || "unreported",
        totals.rounds,
        totals.inputTokens,
        totals.cachedInputTokens,
        totals.outputTokens,
        totals.reasoningTokens,
      )
      .run();
  } catch {
    // Losing a ledger row must never surface to the listener.
    console.error("question usage not recorded");
  }
}

/** Fixed rollups rather than a query language: no SQL reaches this from outside. */
const SUMS = `COUNT(*) AS questions, COALESCE(SUM(rounds),0) AS rounds,
  COALESCE(SUM(input_tokens),0) AS inputTokens,
  COALESCE(SUM(cached_input_tokens),0) AS cachedInputTokens,
  COALESCE(SUM(output_tokens),0) AS outputTokens,
  COALESCE(SUM(reasoning_tokens),0) AS reasoningTokens`;

/**
 * Compares without leaking the answer through timing. Digesting first makes the
 * comparison fixed-length, so a wrong length cannot be distinguished either.
 */
async function sameKey(presented: string, expected: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a),
    right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

/**
 * `GET /api/admin/usage?days=N`. Authenticated by a shared secret in
 * `x-admin-key`, never a query parameter, so the key stays out of logs and
 * browser history. Absent `ADMIN_KEY` leaves the route looking unmounted.
 */
export async function adminUsageRoute(request: Request, env: Env) {
  if (request.method !== "GET") throw new HttpError(405, "不支持的方法");
  if (!env.ADMIN_KEY) throw new HttpError(404, "接口不存在");
  if (!(await sameKey(request.headers.get("x-admin-key") ?? "", env.ADMIN_KEY)))
    throw new HttpError(401, "未授权");
  const days = z.coerce
    .number()
    .int()
    .min(1)
    .max(RETENTION_DAYS)
    .catch(7)
    .parse(new URL(request.url).searchParams.get("days") ?? 7);
  const since = Date.now() - days * 86400000;
  const [totals, byDay, byTier, byModel, byAudience, topOwners] =
    await env.DB.batch([
      env.DB.prepare(
        `SELECT ${SUMS} FROM question_usage WHERE ts>=?`,
      ).bind(since),
      env.DB.prepare(
        `SELECT day, ${SUMS} FROM question_usage WHERE ts>=? GROUP BY day ORDER BY day DESC`,
      ).bind(since),
      env.DB.prepare(
        `SELECT tiers, ${SUMS} FROM question_usage WHERE ts>=? GROUP BY tiers ORDER BY questions DESC`,
      ).bind(since),
      env.DB.prepare(
        `SELECT COALESCE(model,'unreported') AS model, ${SUMS} FROM question_usage WHERE ts>=? GROUP BY model ORDER BY questions DESC`,
      ).bind(since),
      env.DB.prepare(
        `SELECT CASE WHEN account_id IS NULL THEN 'trial' ELSE 'account' END AS audience, ${SUMS}
         FROM question_usage WHERE ts>=? GROUP BY audience ORDER BY questions DESC`,
      ).bind(since),
      env.DB.prepare(
        `SELECT owner_id AS owner, CASE WHEN account_id IS NULL THEN 'trial' ELSE 'account' END AS audience, ${SUMS}
         FROM question_usage WHERE ts>=? GROUP BY owner_id, audience ORDER BY outputTokens DESC LIMIT 10`,
      ).bind(since),
    ]);
  return json({
    generatedAt: new Date().toISOString(),
    days,
    retentionDays: RETENTION_DAYS,
    daily: await readDailyStats(env, days),
    totals: totals.results[0],
    byDay: byDay.results,
    byTier: byTier.results,
    byModel: byModel.results,
    byAudience: byAudience.results,
    topOwners: topOwners.results,
  });
}
