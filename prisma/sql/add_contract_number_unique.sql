-- Уникальность номера договора (чип task_78028258).
-- Номера сквозные по компании (Д-001/2026 … Д-030/2026), поэтому уникальность
-- глобальная, а не в разрезе клиента.
-- Проверено 28.07.2026 перед применением: дублей и пустых номеров нет
-- (CustomerContract 29 записей, CarrierContract 8).

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerContract_contractNumber_key"
    ON "CustomerContract"("contractNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "CarrierContract_contractNumber_key"
    ON "CarrierContract"("contractNumber");
