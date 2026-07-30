-- AlterEnum
-- Добавляем статус DUPLICATES: заявки были, но все отброшены как дубли/пропуски.
-- Отличает этот случай от EMPTY («распознавать нечего»). Значение не используется
-- в этой же миграции, поэтому ADD VALUE безопасен в транзакции (PostgreSQL 12+).
ALTER TYPE "ImportStatus" ADD VALUE 'DUPLICATES' BEFORE 'ERROR';
