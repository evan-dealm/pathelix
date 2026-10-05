-- Security hardening (Oct 2026). Data fixes first, so the new constraints can be created.

-- Emails are now globally unique and stored lowercase (login resolves the tenant from the email).
UPDATE "User" SET "email" = lower(trim("email")) WHERE "email" <> lower(trim("email"));

-- Tracking tokens used to be HMAC-signed session JWTs (role=driver) — a customer holding a
-- tracking link could replay it as a session cookie. Every such token is invalidated here
-- (verifySession also rejects any `track:` subject); new tokens are opaque random strings.
UPDATE "Mission" SET "trackingToken" = NULL WHERE "trackingToken" IS NOT NULL;

-- UserPermission rows left behind by deleted users/tenants (there was no FK) would block the FKs.
DELETE FROM "UserPermission" WHERE "userId" NOT IN (SELECT "id" FROM "User");
DELETE FROM "UserPermission" WHERE "tenantId" NOT IN (SELECT "id" FROM "Tenant");

-- DropIndex
DROP INDEX "PushSubscription_endpoint_key";

-- DropIndex
DROP INDEX "PushSubscription_tenantId_idx";

-- DropIndex
DROP INDEX "Tenant_slug_idx";

-- DropIndex
DROP INDEX "User_email_idx";

-- DropIndex
DROP INDEX "User_tenantId_email_key";

-- AlterTable
ALTER TABLE "IdempotencyKey" ADD COLUMN     "requestHash" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "status" SET DEFAULT 0,
ALTER COLUMN "response" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "trackingTokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PushSubscription_endpoint_idx" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_tenantId_endpoint_key" ON "PushSubscription"("tenantId", "endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

