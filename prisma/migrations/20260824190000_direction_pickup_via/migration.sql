-- Чей рейс забирает груз направления с производства. Пусто = свой рейс.
-- Заборное плечо (производство → хаб) едет на машине другого направления,
-- стоимость внутри его тарифа — отдельного направления на забор не нужно.
-- Аддитивно: nullable-колонка + внешний ключ на себя же (таблица Route).
ALTER TABLE "Route" ADD COLUMN "pickupViaDirectionId" TEXT;
ALTER TABLE "Route" ADD CONSTRAINT "Route_pickupViaDirectionId_fkey"
  FOREIGN KEY ("pickupViaDirectionId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
