-- AddIndex
CREATE INDEX "DriverPosition_tenantId_driverId_recordedAt_idx" ON "DriverPosition"("tenantId", "driverId", "recordedAt" DESC);
