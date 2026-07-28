-- CreateEnum
CREATE TYPE "RequestSource" AS ENUM ('MANUAL', 'EMAIL_IMPORT');

-- AlterTable: признак источника заявки
ALTER TABLE "CustomerRequest" ADD COLUMN "source" "RequestSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable: настройки авто-импорта у контрагента
ALTER TABLE "Customer" ADD COLUMN     "autoImportEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "importSince" TIMESTAMP(3),
ADD COLUMN     "parserKey" TEXT;
