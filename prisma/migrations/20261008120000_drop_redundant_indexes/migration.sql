-- Indexes that duplicate a longer index of the same table (same leading columns): PostgreSQL
-- serves their queries from the longer one. Measured on 10.2 M GPS rows (PERFORMANCE_BENCHMARKS.md):
-- the indexes of "DriverPosition" go from 2 310 MB to 1 552 MB, an insert costs 22 % less, and
-- every read keeps the same plan.
--
-- No data is touched. Dropping an index only updates the catalogue (milliseconds); the lock
-- timeout makes the migration fail rather than wait behind a long transaction.
--
-- To put them back (no downtime):
--   CREATE INDEX CONCURRENTLY "DriverPosition_tenantId_driverId_idx" ON "DriverPosition"("tenantId", "driverId");
--   CREATE INDEX CONCURRENTLY "DriverPosition_driverId_recordedAt_idx" ON "DriverPosition"("driverId", "recordedAt" DESC);
--   CREATE INDEX CONCURRENTLY "Mission_tenantId_idx" ON "Mission"("tenantId");
--   CREATE INDEX CONCURRENTLY "Mission_tenantId_date_idx" ON "Mission"("tenantId", "date");
--   CREATE INDEX CONCURRENTLY "Mission_tenantId_date_archived_idx" ON "Mission"("tenantId", "date", "archived");
--   CREATE INDEX CONCURRENTLY "Driver_tenantId_idx" ON "Driver"("tenantId");
--   CREATE INDEX CONCURRENTLY "AuditLog_tenantId_entityType_idx" ON "AuditLog"("tenantId", "entityType");
SET lock_timeout = '5s';

-- Covered by "DriverPosition_tenantId_driverId_recordedAt_idx"
DROP INDEX IF EXISTS "DriverPosition_tenantId_driverId_idx";
DROP INDEX IF EXISTS "DriverPosition_driverId_recordedAt_idx";

-- Covered by "Mission_tenantId_date_archived_priority_idx"
DROP INDEX IF EXISTS "Mission_tenantId_idx";
DROP INDEX IF EXISTS "Mission_tenantId_date_idx";
DROP INDEX IF EXISTS "Mission_tenantId_date_archived_idx";

-- Covered by "Driver_tenantId_archived_idx"
DROP INDEX IF EXISTS "Driver_tenantId_idx";

-- Covered by "AuditLog_tenantId_entityType_entityId_idx"
DROP INDEX IF EXISTS "AuditLog_tenantId_entityType_idx";
