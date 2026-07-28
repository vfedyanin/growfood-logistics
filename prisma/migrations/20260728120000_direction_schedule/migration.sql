-- Графики поставок для модуля «Планирование» + уникальность номера договора.
--
-- ВАЖНО: на продуктивной базе эти изменения уже применены вручную через
-- `prisma db execute` (27–28.07.2026), поэтому миграция помечена как применённая
-- через `prisma migrate resolve --applied`. Все операции идемпотентны
-- (IF NOT EXISTS), чтобы на чистой базе миграция прошла корректно.

-- DirectionSchedule: договор × направление (или пара локаций) × дни недели.
-- Значение дня недели = количество дней в пути до доставки:
--   NULL — в этот день не возим, 0 — доставка в день забора.
CREATE TABLE IF NOT EXISTS "DirectionSchedule" (
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
  "requestTemplateId"     TEXT,
  -- Историчность: правка не меняет строку на месте, а закрывает её validTo
  -- и создаёт новую версию. Иначе сетка за прошлые недели рисовалась бы
  -- по сегодняшним правилам.
  "validFrom"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo"               TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DirectionSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DirectionSchedule_customerContractId_idx" ON "DirectionSchedule"("customerContractId");
CREATE INDEX IF NOT EXISTS "DirectionSchedule_directionId_idx"        ON "DirectionSchedule"("directionId");
CREATE INDEX IF NOT EXISTS "DirectionSchedule_validFrom_idx"          ON "DirectionSchedule"("validFrom");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectionSchedule_customerContractId_fkey') THEN
    ALTER TABLE "DirectionSchedule"
      ADD CONSTRAINT "DirectionSchedule_customerContractId_fkey"
      FOREIGN KEY ("customerContractId") REFERENCES "CustomerContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Direction физически хранится в таблице Route (поле переименовано в схеме)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectionSchedule_directionId_fkey') THEN
    ALTER TABLE "DirectionSchedule"
      ADD CONSTRAINT "DirectionSchedule_directionId_fkey"
      FOREIGN KEY ("directionId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectionSchedule_originLocationId_fkey') THEN
    ALTER TABLE "DirectionSchedule"
      ADD CONSTRAINT "DirectionSchedule_originLocationId_fkey"
      FOREIGN KEY ("originLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectionSchedule_destinationLocationId_fkey') THEN
    ALTER TABLE "DirectionSchedule"
      ADD CONSTRAINT "DirectionSchedule_destinationLocationId_fkey"
      FOREIGN KEY ("destinationLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectionSchedule_requestTemplateId_fkey') THEN
    ALTER TABLE "DirectionSchedule"
      ADD CONSTRAINT "DirectionSchedule_requestTemplateId_fkey"
      FOREIGN KEY ("requestTemplateId") REFERENCES "RequestTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Уникальность номера договора: номера сквозные по компании (Д-001/2026 …),
-- поэтому уникальность глобальная, а не в разрезе контрагента.
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerContract_contractNumber_key" ON "CustomerContract"("contractNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "CarrierContract_contractNumber_key"  ON "CarrierContract"("contractNumber");
