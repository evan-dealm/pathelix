-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "generatedFromTemplateId" TEXT;

-- CreateIndex
CREATE INDEX "Mission_generatedFromTemplateId_idx" ON "Mission"("generatedFromTemplateId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_generatedFromTemplateId_fkey" FOREIGN KEY ("generatedFromTemplateId") REFERENCES "MissionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
