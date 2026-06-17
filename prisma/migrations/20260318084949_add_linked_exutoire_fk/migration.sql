-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_linkedExutoireId_fkey" FOREIGN KEY ("linkedExutoireId") REFERENCES "Exutoire"("id") ON DELETE SET NULL ON UPDATE CASCADE;
