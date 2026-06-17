-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DISPATCHER', 'DRIVER');

-- CreateEnum
CREATE TYPE "MissionType" AS ENUM ('POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "TenantPlan" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'DRIVER',
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "driverRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "depotName" TEXT NOT NULL,
    "depotLat" DOUBLE PRECISION NOT NULL,
    "depotLng" DOUBLE PRECISION NOT NULL,
    "maxBinSizeM3" DOUBLE PRECISION,
    "vehicleCapacity" INTEGER,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "MissionType" NOT NULL,
    "date" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "estimatedDurationMin" INTEGER NOT NULL,
    "maneuverTimeMin" INTEGER NOT NULL DEFAULT 0,
    "clientName" TEXT,
    "outletName" TEXT,
    "wasteTypeLabel" TEXT,
    "binSize" TEXT,
    "binSizeM3" DOUBLE PRECISION,
    "accessNotes" TEXT,
    "priority" INTEGER,
    "timeWindowOpenMin" INTEGER,
    "timeWindowCloseMin" INTEGER,
    "linkedExutoireId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exutoire" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "openingHoursOpen" INTEGER NOT NULL,
    "openingHoursClose" INTEGER NOT NULL,
    "closedDays" JSONB NOT NULL DEFAULT '[]',
    "acceptedWasteTypes" JSONB NOT NULL DEFAULT '[]',
    "serviceTimeMin" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exutoire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "missions" JSONB NOT NULL,
    "statuses" JSONB NOT NULL DEFAULT '{}',
    "startTime" TEXT NOT NULL DEFAULT '07:00',
    "speedKmh" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "snapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TourHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_slug_idx" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Driver_tenantId_idx" ON "Driver"("tenantId");

-- CreateIndex
CREATE INDEX "Driver_tenantId_archived_idx" ON "Driver"("tenantId", "archived");

-- CreateIndex
CREATE INDEX "Driver_tenantId_sector_idx" ON "Driver"("tenantId", "sector");

-- CreateIndex
CREATE INDEX "Mission_tenantId_idx" ON "Mission"("tenantId");

-- CreateIndex
CREATE INDEX "Mission_tenantId_date_idx" ON "Mission"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Mission_tenantId_archived_idx" ON "Mission"("tenantId", "archived");

-- CreateIndex
CREATE INDEX "Mission_tenantId_date_archived_idx" ON "Mission"("tenantId", "date", "archived");

-- CreateIndex
CREATE INDEX "Mission_tenantId_priority_idx" ON "Mission"("tenantId", "priority");

-- CreateIndex
CREATE INDEX "Mission_linkedExutoireId_idx" ON "Mission"("linkedExutoireId");

-- CreateIndex
CREATE INDEX "Exutoire_tenantId_idx" ON "Exutoire"("tenantId");

-- CreateIndex
CREATE INDEX "Plan_tenantId_date_idx" ON "Plan"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_tenantId_driverId_date_key" ON "Plan"("tenantId", "driverId", "date");

-- CreateIndex
CREATE INDEX "TourHistory_tenantId_date_idx" ON "TourHistory"("tenantId", "date");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exutoire" ADD CONSTRAINT "Exutoire_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourHistory" ADD CONSTRAINT "TourHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
