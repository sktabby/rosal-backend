-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "lrNumber" TEXT,
ADD COLUMN "lrSubmittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BillLineItem" ADD COLUMN "serialNumber" TEXT,
ADD COLUMN "batchNumber" TEXT;
