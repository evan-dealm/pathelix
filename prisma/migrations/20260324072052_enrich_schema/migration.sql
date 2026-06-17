-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "billingAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contractEnd" TIMESTAMP(3),
ADD COLUMN     "contractStart" TIMESTAMP(3),
ADD COLUMN     "externalRef" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "sector" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "siret" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "color" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "emergencyContact" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "employeeNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hiredAt" TIMESTAMP(3),
ADD COLUMN     "licenseCategories" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "licenseExpiry" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "actualDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "actualDurationMin" DOUBLE PRECISION,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "driverComment" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "signatureUrl" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "actualDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "actualDurationMin" INTEGER,
ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "estimatedDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "estimatedDurationMin" INTEGER,
ADD COLUMN     "optimizationScore" DOUBLE PRECISION,
ADD COLUMN     "returnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "city" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'FR',
ADD COLUMN     "openingHoursClose" INTEGER,
ADD COLUMN     "openingHoursOpen" INTEGER,
ADD COLUMN     "siteType" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "zipCode" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "contactEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastActiveAt" TIMESTAMP(3),
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'fr-FR',
ADD COLUMN     "maxDrivers" INTEGER,
ADD COLUMN     "maxMissions" INTEGER,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris';

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "billingEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "invoicePrefix" TEXT NOT NULL DEFAULT 'FAC',
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'fr-FR',
ADD COLUMN     "maxOptimizationsPerDay" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
ADD COLUMN     "vatNumber" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fuelType" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "gpsDeviceId" TEXT,
ADD COLUMN     "insuranceExpiry" TEXT,
ADD COLUMN     "insuranceRef" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastServiceDate" TEXT,
ADD COLUMN     "lastServiceKm" INTEGER,
ADD COLUMN     "vin" TEXT,
ADD COLUMN     "year" INTEGER;

-- CreateTable
CREATE TABLE "MissionComment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "costEur" DOUBLE PRECISION,
    "mileageKm" INTEGER,
    "doneAt" TEXT NOT NULL,
    "doneBy" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "liters" DOUBLE PRECISION NOT NULL,
    "costEur" DOUBLE PRECISION NOT NULL,
    "pricePerLiter" DOUBLE PRECISION,
    "mileageKm" INTEGER NOT NULL DEFAULT 0,
    "stationName" TEXT NOT NULL DEFAULT '',
    "filledAt" TEXT NOT NULL,
    "fullTank" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverPosition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionComment_tenantId_missionId_idx" ON "MissionComment"("tenantId", "missionId");

-- CreateIndex
CREATE INDEX "MissionComment_userId_idx" ON "MissionComment"("userId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_tenantId_idx" ON "MaintenanceRecord"("tenantId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_vehicleId_doneAt_idx" ON "MaintenanceRecord"("vehicleId", "doneAt");

-- CreateIndex
CREATE INDEX "FuelRecord_tenantId_idx" ON "FuelRecord"("tenantId");

-- CreateIndex
CREATE INDEX "FuelRecord_vehicleId_filledAt_idx" ON "FuelRecord"("vehicleId", "filledAt");

-- CreateIndex
CREATE INDEX "FuelRecord_tenantId_filledAt_idx" ON "FuelRecord"("tenantId", "filledAt");

-- CreateIndex
CREATE INDEX "DriverPosition_tenantId_driverId_idx" ON "DriverPosition"("tenantId", "driverId");

-- CreateIndex
CREATE INDEX "DriverPosition_tenantId_recordedAt_idx" ON "DriverPosition"("tenantId", "recordedAt");

-- CreateIndex
CREATE INDEX "DriverPosition_driverId_recordedAt_idx" ON "DriverPosition"("driverId", "recordedAt" DESC);

-- AddForeignKey
ALTER TABLE "MissionComment" ADD CONSTRAINT "MissionComment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionComment" ADD CONSTRAINT "MissionComment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelRecord" ADD CONSTRAINT "FuelRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelRecord" ADD CONSTRAINT "FuelRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverPosition" ADD CONSTRAINT "DriverPosition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
