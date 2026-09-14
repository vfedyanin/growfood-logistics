-- AlterEnum
ALTER TYPE "RequestSource" ADD VALUE IF NOT EXISTS 'API_1C';

-- AlterTable
ALTER TABLE "CustomerRequest" ADD COLUMN "externalKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequest_externalKey_key" ON "CustomerRequest"("externalKey");
