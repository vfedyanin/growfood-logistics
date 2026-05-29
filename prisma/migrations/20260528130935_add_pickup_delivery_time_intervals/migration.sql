-- AlterTable
ALTER TABLE "CustomerRequest" ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "deliveryTimeFrom" TEXT,
ADD COLUMN     "deliveryTimeTo" TEXT,
ADD COLUMN     "pickupDate" TIMESTAMP(3),
ADD COLUMN     "pickupTimeFrom" TEXT,
ADD COLUMN     "pickupTimeTo" TEXT;

-- AlterTable
ALTER TABLE "RequestCargoLeg" ADD COLUMN     "plannedDropoffTo" TEXT,
ADD COLUMN     "plannedPickupTo" TEXT;
