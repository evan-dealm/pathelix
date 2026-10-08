-- "DriverPosition" receives one row per driver every 30 s and loses a whole day of rows every
-- night (retention worker). With the default thresholds autovacuum only runs once 20 % of the
-- table is dead — about six nights of purge — so the table and its indexes carry up to a fifth
-- of dead space permanently, and the visibility map lags behind (slower index-only reads).
-- These settings make it run after each nightly purge instead. Storage parameters only: no data
-- is touched, no lock beyond a brief catalogue update.
--
-- To undo: ALTER TABLE "DriverPosition" RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_insert_scale_factor, autovacuum_analyze_scale_factor);
SET lock_timeout = '5s';

ALTER TABLE "DriverPosition" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
