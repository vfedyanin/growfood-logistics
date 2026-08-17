-- Реквизиты автопланирования у направления: перевозчик и режим набивки машин.
-- Обе колонки необязательные: на существующих направлениях они остаются пустыми,
-- а пустой splitMode означает «направление не настроено, автопланирование его
-- не берёт». Ничего не удаляется и не переписывается.

-- CreateEnum
CREATE TYPE "SplitMode" AS ENUM ('OVERLOAD', 'SPLIT');

-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "carrierId" TEXT,
ADD COLUMN     "splitMode" "SplitMode";

-- AddForeignKey
-- ON DELETE SET NULL: удаление перевозчика из справочника обнуляет ссылку,
-- но само направление не трогает.
ALTER TABLE "Route" ADD CONSTRAINT "Route_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
