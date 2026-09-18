-- CreateEnum
CREATE TYPE "IngestSource" AS ENUM ('FILE', 'API_1C');

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByName" TEXT,
    "source" "IngestSource" NOT NULL,
    "dateFrom" TEXT,
    "dateTo" TEXT,
    "fileName" TEXT,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skippedInwork" INTEGER NOT NULL DEFAULT 0,
    "skippedProducer" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "outcomes" JSONB NOT NULL,

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestRun_createdAt_idx" ON "IngestRun"("createdAt");
