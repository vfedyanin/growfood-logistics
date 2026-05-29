-- CreateTable
CREATE TABLE "CustomerDeliveryLocation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerDeliveryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerDeliveryLocation_customerId_idx" ON "CustomerDeliveryLocation"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDeliveryLocation_customerId_locationId_key" ON "CustomerDeliveryLocation"("customerId", "locationId");

-- AddForeignKey
ALTER TABLE "CustomerDeliveryLocation" ADD CONSTRAINT "CustomerDeliveryLocation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeliveryLocation" ADD CONSTRAINT "CustomerDeliveryLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
