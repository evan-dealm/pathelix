-- CreateTable
CREATE TABLE "SuperadminTotp" (
    "userId" TEXT NOT NULL,
    "secret" JSONB NOT NULL,
    "enabledAt" TIMESTAMP(3),
    "lastStep" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuperadminTotp_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "SuperadminTotp" ADD CONSTRAINT "SuperadminTotp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
