/*
  Warnings:

  - A unique constraint covering the columns `[trackingToken]` on the table `Mission` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "capacityDimensions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "startingExutoireId" TEXT;

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "incidentAt" TIMESTAMP(3),
ADD COLUMN     "incidentNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "incidentType" TEXT,
ADD COLUMN     "requiredSkills" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "trackingToken" TEXT;

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "features" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "interventionFormFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "valhallaFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.60;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "gabaritProfile" TEXT NOT NULL DEFAULT 'pl_26t',
ADD COLUMN     "telepayBadge" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "telepayDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "tollClass" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "MissionTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "type" TEXT NOT NULL,
    "recurrence" JSONB NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "clientName" TEXT NOT NULL DEFAULT '',
    "estimatedDurationMin" INTEGER NOT NULL DEFAULT 30,
    "maneuverTimeMin" INTEGER NOT NULL DEFAULT 10,
    "wasteTypeLabel" TEXT NOT NULL DEFAULT '',
    "binSize" TEXT NOT NULL DEFAULT '',
    "binSizeM3" DOUBLE PRECISION,
    "accessNotes" TEXT NOT NULL DEFAULT '',
    "priority" INTEGER,
    "timeWindow" JSONB,
    "linkedExutoireId" TEXT,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryProof" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "photoUrl" TEXT,
    "signatureUrl" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "driverId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomTrade" (
    "id" TEXT NOT NULL,
    "tradeKey" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "tradeDescription" TEXT NOT NULL DEFAULT '',
    "tradeIcon" TEXT NOT NULL DEFAULT '📋',
    "vocabulary" JSONB NOT NULL,
    "enabledMissionTypes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionTemplate_tenantId_idx" ON "MissionTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "MissionTemplate_tenantId_enabled_idx" ON "MissionTemplate"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryProof_missionId_key" ON "DeliveryProof"("missionId");

-- CreateIndex
CREATE INDEX "DeliveryProof_tenantId_idx" ON "DeliveryProof"("tenantId");

-- CreateIndex
CREATE INDEX "DeliveryProof_driverId_idx" ON "DeliveryProof"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_tenantId_idx" ON "PushSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PushSubscription_driverId_idx" ON "PushSubscription"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomTrade_tradeKey_key" ON "CustomTrade"("tradeKey");

-- CreateIndex
CREATE INDEX "FuelRecord_driverId_idx" ON "FuelRecord"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Mission_trackingToken_key" ON "Mission"("trackingToken");

-- CreateIndex
CREATE INDEX "Mission_dependsOnId_idx" ON "Mission"("dependsOnId");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_startingExutoireId_fkey" FOREIGN KEY ("startingExutoireId") REFERENCES "Exutoire"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionTemplate" ADD CONSTRAINT "MissionTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProof" ADD CONSTRAINT "DeliveryProof_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProof" ADD CONSTRAINT "DeliveryProof_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
