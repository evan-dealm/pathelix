-- CreateEnum
CREATE TYPE "BsdStatus" AS ENUM ('DRAFT', 'SEALED', 'SENT', 'RECEIVED', 'PROCESSED', 'REFUSED', 'AWAITING_GROUP', 'NO_TRACEABILITY', 'CANCELED', 'SIGNED_BY_PRODUCER', 'SIGNED_BY_TRANSPORTER', 'TEMP_STORED', 'TEMP_STORER_ACCEPTED', 'GROUPED', 'RESEALED', 'RESENT', 'INITIAL');

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "needsGeocode" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputData" JSONB NOT NULL DEFAULT '{}',
    "outputData" JSONB,
    "errorMsg" TEXT,
    "missionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackdechetsAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackdechetsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bsd" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tdId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'BSDD',
    "status" "BsdStatus" NOT NULL DEFAULT 'DRAFT',
    "missionId" TEXT,
    "readableId" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bsd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiJob_tenantId_idx" ON "AiJob"("tenantId");

-- CreateIndex
CREATE INDEX "AiJob_tenantId_status_createdAt_idx" ON "AiJob"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_missionId_idx" ON "AiJob"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackdechetsAccount_tenantId_key" ON "TrackdechetsAccount"("tenantId");

-- CreateIndex
CREATE INDEX "TrackdechetsAccount_tenantId_idx" ON "TrackdechetsAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Bsd_tdId_key" ON "Bsd"("tdId");

-- CreateIndex
CREATE INDEX "Bsd_tenantId_status_idx" ON "Bsd"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Bsd_tdId_idx" ON "Bsd"("tdId");

-- CreateIndex
CREATE INDEX "Bsd_missionId_idx" ON "Bsd"("missionId");

-- CreateIndex
CREATE INDEX "InterventionMetric_tenantId_driverId_isReliable_idx" ON "InterventionMetric"("tenantId", "driverId", "isReliable");

-- CreateIndex
CREATE INDEX "InterventionMetric_tenantId_siteId_isReliable_idx" ON "InterventionMetric"("tenantId", "siteId", "isReliable");

-- CreateIndex
CREATE INDEX "InterventionMetric_tenantId_missionType_isReliable_idx" ON "InterventionMetric"("tenantId", "missionType", "isReliable");

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackdechetsAccount" ADD CONSTRAINT "TrackdechetsAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bsd" ADD CONSTRAINT "Bsd_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bsd" ADD CONSTRAINT "Bsd_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
