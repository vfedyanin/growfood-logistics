-- DropForeignKey
ALTER TABLE "Trip" DROP CONSTRAINT "Trip_destinationId_fkey";

-- DropForeignKey
ALTER TABLE "Trip" DROP CONSTRAINT "Trip_originId_fkey";

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "vehicleTypeCode" TEXT,
ALTER COLUMN "originId" DROP NOT NULL,
ALTER COLUMN "destinationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleTypeCode_fkey" FOREIGN KEY ("vehicleTypeCode") REFERENCES "VehicleType"("code") ON DELETE SET NULL ON UPDATE CASCADE;
