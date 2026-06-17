-- CreateTable
CREATE TABLE "InterventionMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "missionType" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "siteId" TEXT,
    "clientId" TEXT,
    "estimatedDurationMin" INTEGER NOT NULL,
    "estimatedManeuverMin" INTEGER NOT NULL DEFAULT 0,
    "estimatedTravelMin" INTEGER,
    "actualDurationMin" DOUBLE PRECISION NOT NULL,
    "actualManeuverMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualTravelMin" DOUBLE PRECISION,
    "actualTotalOnSiteMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "distanceKm" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "enRouteAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3) NOT NULL,
    "isReliable" BOOLEAN NOT NULL DEFAULT true,
    "rejectReason" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterventionMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMLProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "missionType" TEXT NOT NULL,
    "durationCoeff" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "maneuverCoeff" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "travelCoeff" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "medianDurationMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "medianManeuverMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "medianTravelMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMLProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterventionMetric_tenantId_date_idx" ON "InterventionMetric"("tenantId", "date");

-- CreateIndex
CREATE INDEX "InterventionMetric_tenantId_driverId_idx" ON "InterventionMetric"("tenantId", "driverId");

-- CreateIndex
CREATE INDEX "InterventionMetric_tenantId_isReliable_idx" ON "InterventionMetric"("tenantId", "isReliable");

-- CreateIndex
CREATE INDEX "TenantMLProfile_tenantId_idx" ON "TenantMLProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMLProfile_tenantId_scope_scopeId_missionType_key" ON "TenantMLProfile"("tenantId", "scope", "scopeId", "missionType");

-- AddForeignKey
ALTER TABLE "InterventionMetric" ADD CONSTRAINT "InterventionMetric_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMLProfile" ADD CONSTRAINT "TenantMLProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
