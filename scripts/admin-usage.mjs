#!/usr/bin/env node
// Queries the question-cost ledger through /api/admin/usage and prints it.
// The key is read from the environment or .env and is never passed in the URL.
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function fromDotEnv(name) {
  for (const file of [".env", ".dev.vars"]) {
    try {
      const text = await readFile(resolve(root, file), "utf8");
      const line = text
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${name}=`));
      if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
    } catch {
      // Absent file is normal; try the next one.
    }
  }
  return undefined;
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const days = flag("days", "7");
const base = (
  flag("url", process.env.ASIDE_ADMIN_URL) ?? "https://asidefm.com"
).replace(/\/$/, "");
const key =
  process.env.ASIDE_ADMIN_KEY ?? (await fromDotEnv("ASIDE_ADMIN_KEY"));

if (!key) {
  console.error(
    "No admin key. Put ASIDE_ADMIN_KEY in .env (gitignored) or the environment.\n" +
      "It must match the Worker secret: wrangler secret put ADMIN_KEY --config wrangler.production.jsonc",
  );
  process.exit(1);
}

const response = await fetch(`${base}/api/admin/usage?days=${days}`, {
  headers: { "x-admin-key": key },
});
if (!response.ok) {
  const detail = await response.text();
  console.error(
    `${base} returned ${response.status}. ` +
      (response.status === 401
        ? "The key does not match the Worker secret."
        : response.status === 404
          ? "ADMIN_KEY is not set on the Worker, so the route is unmounted."
          : detail.slice(0, 300)),
  );
  process.exit(1);
}
const data = await response.json();

if (args.includes("--json")) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

const n = (value) => Number(value ?? 0).toLocaleString("en-US");
const table = (rows, first) => {
  if (!rows?.length) return "  (no rows)";
  const head = [first, "questions", "rounds", "in", "cached", "out", "reasoning"];
  const body = rows.map((row) => [
    String(row[first] ?? ""),
    n(row.questions),
    n(row.rounds),
    n(row.inputTokens),
    n(row.cachedInputTokens),
    n(row.outputTokens),
    n(row.reasoningTokens),
  ]);
  const width = head.map((_, i) =>
    Math.max(head[i].length, ...body.map((r) => r[i].length)),
  );
  const line = (cells) =>
    "  " + cells.map((c, i) => c.padEnd(width[i])).join("  ");
  return [line(head), line(width.map((w) => "-".repeat(w))), ...body.map(line)].join(
    "\n",
  );
};

const t = data.totals ?? {};
console.log(
  `\nAside question cost · last ${data.days} day(s) · ${base}\n` +
    `generated ${data.generatedAt} · ledger keeps ${data.retentionDays} days\n`,
);
console.log(
  `  ${n(t.questions)} questions over ${n(t.rounds)} model rounds\n` +
    `  input ${n(t.inputTokens)} (cached ${n(t.cachedInputTokens)}) · output ${n(t.outputTokens)} · of which reasoning ${n(t.reasoningTokens)}\n`,
);
console.log("Served tier  (a value containing 'default' means fast mode was downgraded)");
console.log(table(data.byTier, "tiers"));
console.log("\nAudience");
console.log(table(data.byAudience, "audience"));
console.log("\nModel");
console.log(table(data.byModel, "model"));
console.log("\nBy day");
console.log(table(data.byDay, "day"));
console.log("\nTop owners by output tokens");
console.log(table(data.topOwners, "owner"));
console.log();
