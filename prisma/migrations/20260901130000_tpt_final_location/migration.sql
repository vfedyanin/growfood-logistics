-- Третий ключ матча слота шаблона: конечная точка груза (делит забор Йуми по машинам).
ALTER TABLE "TripPlanTemplateLeg" ADD COLUMN "finalLocationId" TEXT;
CREATE INDEX "TripPlanTemplateLeg_finalLocationId_idx" ON "TripPlanTemplateLeg"("finalLocationId");
ALTER TABLE "TripPlanTemplateLeg" ADD CONSTRAINT "TripPlanTemplateLeg_finalLocationId_fkey" FOREIGN KEY ("finalLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
