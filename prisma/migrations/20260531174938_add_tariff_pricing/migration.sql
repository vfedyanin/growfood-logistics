-- CreateEnum
CREATE TYPE "PerTripScope" AS ENUM ('CARGO', 'REQUEST');

-- AlterEnum
ALTER TYPE "CargoPricingMode" ADD VALUE 'TARIFF';

-- AlterTable
ALTER TABLE "CustomerRequest" ADD COLUMN     "perTripScope" "PerTripScope" NOT NULL DEFAULT 'CARGO';
