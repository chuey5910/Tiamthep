-- ตั๋วเรือที่อ่านจากรูป (รอตรวจ) + คำที่ระบบจำจากการเลือกของคน
-- CreateTable
CREATE TABLE "ShipTicket" (
    "id" SERIAL NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "part" INTEGER NOT NULL,
    "folderPlate" TEXT NOT NULL,
    "ocrText" TEXT NOT NULL,
    "ticketNo" TEXT,
    "ticketDate" TIMESTAMP(3),
    "weightIn" DOUBLE PRECISION,
    "weightOut" DOUBLE PRECISION,
    "weightNet" DOUBLE PRECISION,
    "plateOnTicket" TEXT,
    "driverNameOnTicket" TEXT,
    "status" TEXT NOT NULL DEFAULT 'รอตรวจ',
    "jobId" INTEGER,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrAlias" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "OcrAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipTicket_jobId_key" ON "ShipTicket"("jobId");

-- CreateIndex
CREATE INDEX "ShipTicket_status_idx" ON "ShipTicket"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ShipTicket_fileId_part_key" ON "ShipTicket"("fileId", "part");

-- CreateIndex
CREATE UNIQUE INDEX "OcrAlias_kind_raw_key" ON "OcrAlias"("kind", "raw");

