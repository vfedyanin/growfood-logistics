-- Историчность графиков (задача #22).
-- Аддитивно: две новые колонки, существующие строки не удаляются и не меняются,
-- кроме заполнения validFrom.
-- Существующим 7 графикам ставим 01.01.2026 (согласовано 27.07.2026), чтобы
-- прошлые недели в сетке планирования не оказались «без графика».

ALTER TABLE "DirectionSchedule" ADD COLUMN IF NOT EXISTS "validFrom" TIMESTAMP(3);
ALTER TABLE "DirectionSchedule" ADD COLUMN IF NOT EXISTS "validTo"   TIMESTAMP(3);

UPDATE "DirectionSchedule"
   SET "validFrom" = TIMESTAMP '2026-01-01 00:00:00'
 WHERE "validFrom" IS NULL;

ALTER TABLE "DirectionSchedule" ALTER COLUMN "validFrom" SET NOT NULL;

-- Выборка версии, действующей на отображаемую неделю
CREATE INDEX IF NOT EXISTS "DirectionSchedule_validFrom_idx"
    ON "DirectionSchedule"("validFrom");
