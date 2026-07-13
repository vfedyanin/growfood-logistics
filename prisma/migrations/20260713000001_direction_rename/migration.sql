-- Make originId/destinationId nullable on Route (were NOT NULL in 0_init)
ALTER TABLE "Route" ALTER COLUMN "originId" DROP NOT NULL;
ALTER TABLE "Route" ALTER COLUMN "destinationId" DROP NOT NULL;

-- Drop unused columns from Route
ALTER TABLE "Route" DROP COLUMN IF EXISTS "estimatedHours";
ALTER TABLE "Route" DROP COLUMN IF EXISTS "routeType";

-- Drop unused enum
DROP TYPE IF EXISTS "RouteType";

-- Add directionId to RequestCargoLeg
ALTER TABLE "RequestCargoLeg" ADD COLUMN IF NOT EXISTS "directionId" TEXT;

-- Fix AdditionalService.updatedAt default
ALTER TABLE "AdditionalService" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Recreate Tariff.vehicleTypeCode FK with SET NULL on delete
ALTER TABLE "Tariff" DROP CONSTRAINT IF EXISTS "Tariff_vehicleTypeCode_fkey";
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_vehicleTypeCode_fkey" FOREIGN KEY ("vehicleTypeCode") REFERENCES "VehicleType"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add FK for RequestCargoLeg.directionId -> Route
ALTER TABLE "RequestCargoLeg" DROP CONSTRAINT IF EXISTS "RequestCargoLeg_directionId_fkey";
ALTER TABLE "RequestCargoLeg" ADD CONSTRAINT "RequestCargoLeg_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
