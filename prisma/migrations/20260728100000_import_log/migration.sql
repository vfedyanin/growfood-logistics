-- CreateEnum
CREATE TYPE "ImportTrigger" AS ENUM ('MANUAL', 'CRON');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'EMPTY', 'ERROR');

-- CreateTable
CREATE TABLE "ImportLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" "ImportTrigger" NOT NULL,
    "customerId" TEXT,
    "source" TEXT,
    "status" "ImportStatus" NOT NULL,
    "stage" TEXT,
    "ocrChars" INTEGER,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "createdNumbers" TEXT[],
    "message" TEXT,
    "details" JSONB,
    "createdById" TEXT,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportLog_createdAt_idx" ON "ImportLog"("createdAt");

-- CreateIndex
CREATE INDEX "ImportLog_customerId_idx" ON "ImportLog"("customerId");

-- AddForeignKey
ALTER TABLE "ImportLog" ADD CONSTRAINT "ImportLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
