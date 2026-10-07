-- เก็บน้ำหนัก/ราคา/ข้อมูลที่พิมพ์บนใบ ณ ตอนออกบิล + ประวัติการปรับยอด
-- ใบที่ออกก่อนหน้านี้: ช่องใหม่เป็นค่าว่าง ไม่แตะยอดเดิม

-- AlterTable
ALTER TABLE "CustomerBillingLine" ADD COLUMN     "date" TIMESTAMP(3),
ADD COLUMN     "destination" TEXT,
ADD COLUMN     "origin" TEXT,
ADD COLUMN     "plate" TEXT,
ADD COLUMN     "priceUnit" TEXT,
ADD COLUMN     "rate" DOUBLE PRECISION,
ADD COLUMN     "ticketOrigin" TEXT,
ADD COLUMN     "weightDest" DOUBLE PRECISION,
ADD COLUMN     "weightOrigin" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "CustomerBillingAdjustment" (
    "id" SERIAL NOT NULL,
    "billingId" INTEGER NOT NULL,
    "adjustedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adjustedBy" TEXT,
    "oldAmount" DOUBLE PRECISION NOT NULL,
    "newAmount" DOUBLE PRECISION NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "CustomerBillingAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerBillingAdjustment_billingId_idx" ON "CustomerBillingAdjustment"("billingId");

-- AddForeignKey
ALTER TABLE "CustomerBillingAdjustment" ADD CONSTRAINT "CustomerBillingAdjustment_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "CustomerBilling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

