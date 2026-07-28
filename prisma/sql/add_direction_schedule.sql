CREATE TABLE "DirectionSchedule" (
  "id"                    TEXT NOT NULL,
  "customerContractId"    TEXT NOT NULL,
  "directionId"           TEXT,
  "originLocationId"      TEXT,
  "destinationLocationId" TEXT,
  "mon"                   INTEGER,
  "tue"                   INTEGER,
  "wed"                   INTEGER,
  "thu"                   INTEGER,
  "fri"                   INTEGER,
  "sat"                   INTEGER,
  "sun"                   INTEGER,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DirectionSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectionSchedule_customerContractId_fkey"
    FOREIGN KEY ("customerContractId") REFERENCES "CustomerContract"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectionSchedule_directionId_fkey"
    FOREIGN KEY ("directionId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "DirectionSchedule_originLocationId_fkey"
    FOREIGN KEY ("originLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "DirectionSchedule_destinationLocationId_fkey"
    FOREIGN KEY ("destinationLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "DirectionSchedule_customerContractId_idx" ON "DirectionSchedule"("customerContractId");
CREATE INDEX "DirectionSchedule_directionId_idx" ON "DirectionSchedule"("directionId");
