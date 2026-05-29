-- AlterTable
ALTER TABLE "RequestCargo" ADD COLUMN     "consigneeLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "RequestCargo" ADD CONSTRAINT "RequestCargo_consigneeLocationId_fkey" FOREIGN KEY ("consigneeLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
