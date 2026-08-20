-- Каркас маршрута направления: упорядоченный список точек объезда.
CREATE TABLE "RouteStop" (
    "id" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteStop_directionId_position_key" ON "RouteStop"("directionId", "position");
CREATE INDEX "RouteStop_directionId_idx" ON "RouteStop"("directionId");

-- Direction маппится на таблицу "Route"; при удалении направления остановки уходят с ним.
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_directionId_fkey"
    FOREIGN KEY ("directionId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
