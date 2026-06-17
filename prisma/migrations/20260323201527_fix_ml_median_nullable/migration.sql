-- AlterTable
ALTER TABLE "TenantMLProfile" ALTER COLUMN "medianDurationMin" DROP NOT NULL,
ALTER COLUMN "medianDurationMin" DROP DEFAULT,
ALTER COLUMN "medianManeuverMin" DROP NOT NULL,
ALTER COLUMN "medianManeuverMin" DROP DEFAULT,
ALTER COLUMN "medianTravelMin" DROP NOT NULL,
ALTER COLUMN "medianTravelMin" DROP DEFAULT;
