-- Жёсткий шаблон рейса для автоплана: одна машина с фиксированным набором плеч.

CREATE TABLE "TripPlanTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "vehicleTypeCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "TripPlanTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripPlanTemplate_name_key" ON "TripPlanTemplate"("name");
CREATE INDEX "TripPlanTemplate_carrierId_idx" ON "TripPlanTemplate"("carrierId");

CREATE TABLE "TripPlanTemplateLeg" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "pickupLocationId" TEXT NOT NULL,
    "dropoffLocationId" TEXT NOT NULL,
    "directionId" TEXT,
    CONSTRAINT "TripPlanTemplateLeg_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripPlanTemplateLeg_templateId_position_key" ON "TripPlanTemplateLeg"("templateId", "position");
CREATE INDEX "TripPlanTemplateLeg_templateId_idx" ON "TripPlanTemplateLeg"("templateId");
CREATE INDEX "TripPlanTemplateLeg_pickupLocationId_dropoffLocationId_idx" ON "TripPlanTemplateLeg"("pickupLocationId", "dropoffLocationId");

ALTER TABLE "TripPlanTemplate" ADD CONSTRAINT "TripPlanTemplate_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripPlanTemplate" ADD CONSTRAINT "TripPlanTemplate_vehicleTypeCode_fkey" FOREIGN KEY ("vehicleTypeCode") REFERENCES "VehicleType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripPlanTemplateLeg" ADD CONSTRAINT "TripPlanTemplateLeg_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TripPlanTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripPlanTemplateLeg" ADD CONSTRAINT "TripPlanTemplateLeg_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripPlanTemplateLeg" ADD CONSTRAINT "TripPlanTemplateLeg_dropoffLocationId_fkey" FOREIGN KEY ("dropoffLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripPlanTemplateLeg" ADD CONSTRAINT "TripPlanTemplateLeg_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
