-- Shadow comparison of Jev (a fast structured-decision model) against the
-- backend model's first decision for each heard utterance. Evidence for
-- whether Jev could take over admission. It changes no behaviour. No utterance
-- text is stored. `status` other than "ok" counts availability: timeout (no
-- answer in 3 s), http_<code>, invalid, network. A live path could afford
-- about 300 ms, so read `jev_ms` against that line.
CREATE TABLE jev_shadow (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  jev_ms INTEGER NOT NULL,
  jev TEXT,
  confidence REAL,
  backend TEXT,
  backend_ms INTEGER,
  agree INTEGER,
  characters INTEGER NOT NULL,
  han INTEGER NOT NULL,
  was_playing INTEGER NOT NULL
);
CREATE INDEX jev_shadow_day ON jev_shadow(day);
