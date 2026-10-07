-- CreateTable
CREATE TABLE "DemoRequest" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "fleetSize" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoRequest_createdAt_idx" ON "DemoRequest"("createdAt");
