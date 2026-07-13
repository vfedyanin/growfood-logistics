-- Migration: Route → Direction (manual, 13.07.2026)
-- originId/destinationId остаются в таблице Route (Direction использует их)
-- Удаляем только estimatedHours и routeType (устаревшие поля)

-- DropForeignKey
ALTER TABLE "Tariff" DROP CONSTRAINT "Tariff_vehicleTypeCode_fkey";

-- AlterTable: RequestCargoLeg — добавляем directionId
ALTER TABLE "RequestCargoLeg" ADD COLUMN "directionId" TEXT;

-- AlterTable: Route — убираем устаревшие поля, originId/destinationId оставляем
ALTER TABLE "Route" DROP COLUMN IF EXISTS "estimatedHours",
DROP COLUMN IF EXISTS "routeType";

-- DropEnum (только если существует)
DROP TYPE IF EXISTS "RouteType";

-- AlterTable: AdditionalService
ALTER TABLE "AdditionalService" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey: Tariff vehicleTypeCode
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_vehicleTypeCode_fkey" FOREIGN KEY ("vehicleTypeCode") REFERENCES "VehicleType"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: RequestCargoLeg directionId → Route
ALTER TABLE "RequestCargoLeg" ADD CONSTRAINT "RequestCargoLeg_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
