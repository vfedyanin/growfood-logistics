-- AlterTable
ALTER TABLE "CustomerDeliveryLocation" ADD COLUMN     "tariffAmount" DECIMAL(10,2),
ALTER COLUMN "updatedAt" DROP DEFAULT;
