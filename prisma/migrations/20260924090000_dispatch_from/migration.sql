-- AlterTable
ALTER TABLE "FactoryUnit" ADD COLUMN "dispatchFrom" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN "dispatchFrom" TEXT;
