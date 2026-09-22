-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "billingDueDay" INTEGER,
ADD COLUMN     "vatRate" DOUBLE PRECISION,
ADD COLUMN     "whtRate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "CustomerBilling" (
    "id" SERIAL NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "billedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "legs" INTEGER NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "whtRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "whtAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerBillingLine" (
    "id" SERIAL NOT NULL,
    "billingId" INTEGER NOT NULL,
    "jobId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerBillingLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBilling_invoiceNo_key" ON "CustomerBilling"("invoiceNo");

-- CreateIndex
CREATE INDEX "CustomerBilling_customerId_billedAt_idx" ON "CustomerBilling"("customerId", "billedAt");

-- CreateIndex
CREATE INDEX "CustomerBilling_billedAt_idx" ON "CustomerBilling"("billedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBillingLine_jobId_key" ON "CustomerBillingLine"("jobId");

-- CreateIndex
CREATE INDEX "CustomerBillingLine_billingId_idx" ON "CustomerBillingLine"("billingId");

-- AddForeignKey
ALTER TABLE "CustomerBilling" ADD CONSTRAINT "CustomerBilling_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBillingLine" ADD CONSTRAINT "CustomerBillingLine_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "CustomerBilling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBillingLine" ADD CONSTRAINT "CustomerBillingLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
