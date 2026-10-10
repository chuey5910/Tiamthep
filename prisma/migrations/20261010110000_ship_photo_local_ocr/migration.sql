-- ตัวอ่านที่สอง (Tesseract บนเครื่อง): เก็บรูป + สถานะการอ่านซ้ำ · หมายเหตุเมื่อ 2 ตัวอ่านอ่านไม่ตรงกัน
-- AlterTable
ALTER TABLE "ShipTicket" ADD COLUMN     "readNote" TEXT;

-- CreateTable
CREATE TABLE "ShipPhoto" (
    "fileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "folderPlate" TEXT NOT NULL,
    "googleText" TEXT NOT NULL,
    "localStatus" TEXT NOT NULL DEFAULT 'รอ',
    "localError" TEXT,
    "localTries" INTEGER NOT NULL DEFAULT 0,
    "localAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipPhoto_pkey" PRIMARY KEY ("fileId")
);

-- CreateIndex
CREATE INDEX "ShipPhoto_localStatus_idx" ON "ShipPhoto"("localStatus");

