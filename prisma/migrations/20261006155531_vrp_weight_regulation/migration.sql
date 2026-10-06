-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "binTareKg" DOUBLE PRECISION,
ADD COLUMN     "materialId" TEXT,
ADD COLUMN     "weightKg" DOUBLE PRECISION,
ADD COLUMN     "weightSource" TEXT,
ADD COLUMN     "weightUncertaintyKg" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "breakDuringWait" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lunchBreakDurationMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "lunchBreakEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lunchBreakEnd" TEXT NOT NULL DEFAULT '13:30',
ADD COLUMN     "lunchBreakStart" TEXT NOT NULL DEFAULT '12:00';

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "payloadKg" INTEGER,
ADD COLUMN     "tareKg" INTEGER;

-- CreateTable
CREATE TABLE "VehicleUnavailability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wasteCode" TEXT NOT NULL DEFAULT '',
    "densityKgM3" DOUBLE PRECISION,
    "fillFactor" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "uncertaintyPct" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "hazardous" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleUnavailability_tenantId_startDate_endDate_idx" ON "VehicleUnavailability"("tenantId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "VehicleUnavailability_vehicleId_idx" ON "VehicleUnavailability"("vehicleId");

-- CreateIndex
CREATE INDEX "Material_tenantId_archived_idx" ON "Material"("tenantId", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "Material_tenantId_name_key" ON "Material"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Mission_materialId_idx" ON "Mission"("materialId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleUnavailability" ADD CONSTRAINT "VehicleUnavailability_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleUnavailability" ADD CONSTRAINT "VehicleUnavailability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
