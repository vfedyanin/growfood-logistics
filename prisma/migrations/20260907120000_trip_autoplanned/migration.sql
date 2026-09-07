-- Флаг «рейс создан автопланом» для идемпотентного пересбора (см. Trip.autoPlanned).
ALTER TABLE "Trip" ADD COLUMN "autoPlanned" BOOLEAN NOT NULL DEFAULT false;
