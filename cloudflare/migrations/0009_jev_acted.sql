-- Jev now acts ahead of the backend on a confident ignore, pause or resume.
-- `acted` marks those rows: `acted = 1 AND agree = 0` is a decision the
-- listener saw the backend take back.
ALTER TABLE jev_shadow ADD COLUMN acted INTEGER NOT NULL DEFAULT 0;
