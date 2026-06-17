-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MissionType" ADD VALUE 'CHARGER_IMMEDIAT';
ALTER TYPE "MissionType" ADD VALUE 'DEPLACER';
ALTER TYPE "MissionType" ADD VALUE 'TASSER';
ALTER TYPE "MissionType" ADD VALUE 'EXPEDIER';

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "equipmentType" TEXT,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "siteId" TEXT,
ADD COLUMN     "voucherDelivered" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "vip" BOOLEAN NOT NULL DEFAULT false,
    "requiresDeposit" BOOLEAN NOT NULL DEFAULT false,
    "ecoResponsable" BOOLEAN NOT NULL DEFAULT false,
    "requiresBsd" BOOLEAN NOT NULL DEFAULT false,
    "voucherRequired" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "latitude" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "longitude" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accessNotes" TEXT NOT NULL DEFAULT '',
    "defaultManeuverMin" INTEGER NOT NULL DEFAULT 15,
    "sector" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSite" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,

    CONSTRAINT "ClientSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "wasteType" TEXT NOT NULL,
    "binSizeLabel" TEXT NOT NULL DEFAULT '',
    "binSizeM3" DOUBLE PRECISION,
    "equipmentType" TEXT NOT NULL DEFAULT '',
    "defaultDurationMin" INTEGER NOT NULL DEFAULT 30,
    "defaultExutoireId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_tenantId_idx" ON "Client"("tenantId");

-- CreateIndex
CREATE INDEX "Client_tenantId_archived_idx" ON "Client"("tenantId", "archived");

-- CreateIndex
CREATE INDEX "Client_tenantId_name_idx" ON "Client"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Site_tenantId_idx" ON "Site"("tenantId");

-- CreateIndex
CREATE INDEX "Site_tenantId_archived_idx" ON "Site"("tenantId", "archived");

-- CreateIndex
CREATE INDEX "Site_tenantId_name_idx" ON "Site"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ClientSite_clientId_idx" ON "ClientSite"("clientId");

-- CreateIndex
CREATE INDEX "ClientSite_siteId_idx" ON "ClientSite"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSite_clientId_siteId_key" ON "ClientSite"("clientId", "siteId");

-- CreateIndex
CREATE INDEX "SiteProduct_tenantId_idx" ON "SiteProduct"("tenantId");

-- CreateIndex
CREATE INDEX "SiteProduct_siteId_clientId_idx" ON "SiteProduct"("siteId", "clientId");

-- CreateIndex
CREATE INDEX "SiteProduct_tenantId_archived_idx" ON "SiteProduct"("tenantId", "archived");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_idx" ON "AuditLog"("tenantId", "entityType");

-- CreateIndex
CREATE INDEX "Mission_clientId_idx" ON "Mission"("clientId");

-- CreateIndex
CREATE INDEX "Mission_siteId_idx" ON "Mission"("siteId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSite" ADD CONSTRAINT "ClientSite_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSite" ADD CONSTRAINT "ClientSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteProduct" ADD CONSTRAINT "SiteProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteProduct" ADD CONSTRAINT "SiteProduct_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteProduct" ADD CONSTRAINT "SiteProduct_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteProduct" ADD CONSTRAINT "SiteProduct_defaultExutoireId_fkey" FOREIGN KEY ("defaultExutoireId") REFERENCES "Exutoire"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SiteProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
