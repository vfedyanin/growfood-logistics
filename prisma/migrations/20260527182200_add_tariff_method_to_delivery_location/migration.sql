-- CreateEnum
CREATE TYPE "TariffMethod" AS ENUM ('PER_PALLET', 'PER_TRIP');

-- AlterTable
ALTER TABLE "CustomerDeliveryLocation"
ADD COLUMN "tariffMethod" "TariffMethod",
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
