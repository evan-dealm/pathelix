-- CreateEnum
CREATE TYPE "ContainerStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_TRANSIT', 'AT_CUSTOMER', 'FULL', 'TO_COLLECT', 'AT_EXUTOIRE', 'MAINTENANCE', 'IMMOBILIZED', 'LOST', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "collectedContainerId" TEXT,
ADD COLUMN     "containerTypeId" TEXT,
ADD COLUMN     "placedContainerId" TEXT;

-- CreateTable
CREATE TABLE "ContainerType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacityM3" DOUBLE PRECISION NOT NULL,
    "lengthM" DOUBLE PRECISION,
    "widthM" DOUBLE PRECISION,
    "heightM" DOUBLE PRECISION,
    "tareKg" DOUBLE PRECISION,
    "allowedMaterials" JSONB NOT NULL DEFAULT '[]',
    "dailyRentalPrice" DOUBLE PRECISION,
    "purchaseCost" DOUBLE PRECISION,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContainerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Container" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "status" "ContainerStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" TEXT NOT NULL DEFAULT 'good',
    "clientId" TEXT,
    "siteId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationLabel" TEXT NOT NULL DEFAULT '',
    "driverId" TEXT,
    "missionId" TEXT,
    "materialId" TEXT,
    "placedAt" TIMESTAMP(3),
    "lastRotationAt" TIMESTAMP(3),
    "lastMovementAt" TIMESTAMP(3),
    "purchaseDate" TEXT,
    "purchaseCost" DOUBLE PRECISION,
    "notes" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Container_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContainerEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "ContainerStatus",
    "toStatus" "ContainerStatus",
    "missionId" TEXT,
    "clientId" TEXT,
    "siteId" TEXT,
    "driverId" TEXT,
    "userId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "notes" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContainerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContainerType_tenantId_archived_idx" ON "ContainerType"("tenantId", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "ContainerType_tenantId_name_key" ON "ContainerType"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Container_qrToken_key" ON "Container"("qrToken");

-- CreateIndex
CREATE INDEX "Container_tenantId_status_idx" ON "Container"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Container_tenantId_typeId_status_idx" ON "Container"("tenantId", "typeId", "status");

-- CreateIndex
CREATE INDEX "Container_tenantId_clientId_idx" ON "Container"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Container_tenantId_siteId_idx" ON "Container"("tenantId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Container_tenantId_number_key" ON "Container"("tenantId", "number");

-- CreateIndex
CREATE INDEX "ContainerEvent_tenantId_containerId_at_idx" ON "ContainerEvent"("tenantId", "containerId", "at" DESC);

-- CreateIndex
CREATE INDEX "ContainerEvent_tenantId_missionId_idx" ON "ContainerEvent"("tenantId", "missionId");

-- CreateIndex
CREATE INDEX "ContainerEvent_tenantId_clientId_at_idx" ON "ContainerEvent"("tenantId", "clientId", "at");

-- CreateIndex
CREATE INDEX "ContainerEvent_tenantId_at_idx" ON "ContainerEvent"("tenantId", "at");

-- CreateIndex
CREATE INDEX "Mission_placedContainerId_idx" ON "Mission"("placedContainerId");

-- CreateIndex
CREATE INDEX "Mission_collectedContainerId_idx" ON "Mission"("collectedContainerId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_containerTypeId_fkey" FOREIGN KEY ("containerTypeId") REFERENCES "ContainerType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_placedContainerId_fkey" FOREIGN KEY ("placedContainerId") REFERENCES "Container"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_collectedContainerId_fkey" FOREIGN KEY ("collectedContainerId") REFERENCES "Container"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerType" ADD CONSTRAINT "ContainerType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ContainerType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerEvent" ADD CONSTRAINT "ContainerEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerEvent" ADD CONSTRAINT "ContainerEvent_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE CASCADE ON UPDATE CASCADE;
