-- AlterTable
ALTER TABLE "CarrierContract" ADD COLUMN     "vatRatePct" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CustomerContract" ADD COLUMN     "vatRatePct" INTEGER NOT NULL DEFAULT 0;
