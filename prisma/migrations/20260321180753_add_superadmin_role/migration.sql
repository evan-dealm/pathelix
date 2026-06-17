-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPERADMIN';

-- DropIndex
DROP INDEX "AuditLog_tenantId_createdAt_idx";

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Mission_tenantId_date_archived_priority_idx" ON "Mission"("tenantId", "date", "archived", "priority");

-- CreateIndex
CREATE INDEX "Plan_driverId_idx" ON "Plan"("driverId");

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
