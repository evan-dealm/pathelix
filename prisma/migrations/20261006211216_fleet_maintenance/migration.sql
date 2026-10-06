-- AlterTable
ALTER TABLE "MaintenanceRecord" ADD COLUMN     "planId" TEXT;

-- CreateTable
CREATE TABLE "MaintenancePlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "everyKm" INTEGER,
    "everyMonths" INTEGER,
    "lastDoneAt" TEXT,
    "lastDoneKm" INTEGER,
    "dueDate" TEXT,
    "warnDays" INTEGER NOT NULL DEFAULT 30,
    "warnKm" INTEGER NOT NULL DEFAULT 1500,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDefect" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "reportedBy" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "mileageKm" INTEGER,
    "photoDocumentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT NOT NULL DEFAULT '',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "maintenanceRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleDefect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenancePlan_tenantId_vehicleId_idx" ON "MaintenancePlan"("tenantId", "vehicleId");

-- CreateIndex
CREATE INDEX "VehicleDefect_tenantId_vehicleId_status_idx" ON "VehicleDefect"("tenantId", "vehicleId", "status");

-- CreateIndex
CREATE INDEX "VehicleDefect_tenantId_status_idx" ON "VehicleDefect"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDefect" ADD CONSTRAINT "VehicleDefect_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDefect" ADD CONSTRAINT "VehicleDefect_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
