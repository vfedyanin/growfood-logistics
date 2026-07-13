-- Add origin/destination location fields directly to Tariff
ALTER TABLE "Tariff" ADD COLUMN IF NOT EXISTS "originLocationId" TEXT;
ALTER TABLE "Tariff" ADD COLUMN IF NOT EXISTS "destinationLocationId" TEXT;

-- Populate from auto-generated directions (those that have originId/destinationId set)
UPDATE "Tariff" t
SET "originLocationId" = r."originId",
    "destinationLocationId" = r."destinationId"
FROM "Route" r
WHERE t."routeId" = r.id
  AND r."originId" IS NOT NULL
  AND r."destinationId" IS NOT NULL;

-- Clear routeId on tariffs that now have location fields (they were pointing to auto-generated directions)
UPDATE "Tariff" SET "routeId" = NULL
WHERE "originLocationId" IS NOT NULL;

-- Add FK constraints for new location fields
ALTER TABLE "Tariff" DROP CONSTRAINT IF EXISTS "Tariff_originLocationId_fkey";
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_originLocationId_fkey"
  FOREIGN KEY ("originLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Tariff" DROP CONSTRAINT IF EXISTS "Tariff_destinationLocationId_fkey";
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_destinationLocationId_fkey"
  FOREIGN KEY ("destinationLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Delete auto-generated directions (originId/destinationId IS NOT NULL = created by findOrCreateDirection)
-- Only those with no remaining references
DELETE FROM "Route"
WHERE "originId" IS NOT NULL
  AND "destinationId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Trip"           WHERE "routeId"     = "Route"."id")
  AND NOT EXISTS (SELECT 1 FROM "Tariff"         WHERE "routeId"     = "Route"."id")
  AND NOT EXISTS (SELECT 1 FROM "MarketPrice"    WHERE "routeId"     = "Route"."id")
  AND NOT EXISTS (SELECT 1 FROM "RequestCargoLeg" WHERE "directionId" = "Route"."id");
