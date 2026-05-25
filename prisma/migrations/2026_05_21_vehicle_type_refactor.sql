-- Vehicle → VehicleType refactor (data-preserving)
-- Run on Neon dev branch first; same script will apply to prod when ready.

BEGIN;

-- 1) Rename the old enum so the new table name does not collide
ALTER TYPE "VehicleType" RENAME TO "VehicleType_old";

-- 2) Create the new VehicleType table (dictionary of transport types)
CREATE TABLE "VehicleType" (
  "id"              TEXT PRIMARY KEY,
  "name"            TEXT NOT NULL UNIQUE,
  "capacityKg"      DECIMAL(10,2),
  "capacityM3"      DECIMAL(10,2),
  "capacityPallets" INTEGER,
  "hasRefrigerator" BOOLEAN NOT NULL DEFAULT FALSE,
  "tempMin"         DECIMAL(4,1),
  "tempMax"         DECIMAL(4,1),
  "isActive"        BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3) Seed the three canonical types matching the old enum values
INSERT INTO "VehicleType" (id, name, "capacityKg", "capacityPallets", "hasRefrigerator", "tempMin", "tempMax") VALUES
  ('vt_truck',        'Фура',         15000, 22, FALSE, NULL, NULL),
  ('vt_van',          'Газель',        3500,  6, FALSE, NULL, NULL),
  ('vt_refrigerator', 'Рефрижератор', 20000, 33, TRUE,  -25,   10);

-- 4) Trip: add vehicleTypeId + plateNumber, then backfill from Vehicle
ALTER TABLE "Trip" ADD COLUMN "vehicleTypeId" TEXT;
ALTER TABLE "Trip" ADD COLUMN "plateNumber"   TEXT;

UPDATE "Trip" t SET
  "vehicleTypeId" = CASE v.type::text
    WHEN 'TRUCK'        THEN 'vt_truck'
    WHEN 'VAN'          THEN 'vt_van'
    WHEN 'REFRIGERATOR' THEN 'vt_refrigerator'
  END,
  "plateNumber" = v."plateNumber"
FROM "Vehicle" v
WHERE t."vehicleId" = v.id;

-- 5) MarketPrice: add vehicleTypeId, backfill, drop old enum column
ALTER TABLE "MarketPrice" ADD COLUMN "vehicleTypeId" TEXT;

UPDATE "MarketPrice" SET "vehicleTypeId" = CASE "vehicleType"::text
  WHEN 'TRUCK'        THEN 'vt_truck'
  WHEN 'VAN'          THEN 'vt_van'
  WHEN 'REFRIGERATOR' THEN 'vt_refrigerator'
END;

ALTER TABLE "MarketPrice" ALTER COLUMN "vehicleTypeId" SET NOT NULL;

-- 6) Drop old structures
ALTER TABLE "Trip"        DROP COLUMN "vehicleId";
ALTER TABLE "MarketPrice" DROP COLUMN "vehicleType";
DROP TABLE  "Vehicle";
DROP TYPE   "VehicleType_old";

-- 7) Add foreign keys to the new VehicleType table
ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_vehicleTypeId_fkey"
  FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketPrice"
  ADD CONSTRAINT "MarketPrice_vehicleTypeId_fkey"
  FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
