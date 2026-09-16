-- Daily snapshots, in long format so a new metric needs no migration.
-- The trial counters this captures live in `budgets` for two days before the
-- scheduled cleanup drops them, and `voice_usage` carries no timestamp at all,
-- so without this table those numbers are gone rather than merely old.
-- A handful of rows per day: this table is never pruned.
CREATE TABLE daily_stats (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (day, metric)
);
CREATE INDEX daily_stats_metric ON daily_stats(metric, day);
