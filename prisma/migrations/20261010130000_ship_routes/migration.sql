-- ตั๋วเรือหลายเส้นทาง / หลายแบบตั๋ว
-- โฟลเดอร์ใน Drive: ตั๋วเรือ / <ต้นทาง - ปลายทาง> / <ทะเบียน> — ค่าตั้งต่อโฟลเดอร์เส้นทางอยู่ที่ ShipRoute

-- AlterTable
ALTER TABLE "ShipPhoto" ADD COLUMN     "format" TEXT,
ADD COLUMN     "routeFolder" TEXT NOT NULL DEFAULT 'ท่าเรือศรีราชาฮาร์เบอร์ - โกดังท่าเรือศรีราชาฮาร์เบอร์';

-- AlterTable
ALTER TABLE "ShipTicket" ADD COLUMN     "routeFolder" TEXT NOT NULL DEFAULT 'ท่าเรือศรีราชาฮาร์เบอร์ - โกดังท่าเรือศรีราชาฮาร์เบอร์';

-- CreateTable
CREATE TABLE "ShipRoute" (
    "id" SERIAL NOT NULL,
    "folderName" TEXT NOT NULL,
    "origin" TEXT,
    "destination" TEXT,
    "customerId" INTEGER,
    "format" TEXT NOT NULL DEFAULT 'generic',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipRoute_folderName_key" ON "ShipRoute"("folderName");

-- เส้นทางเดิม (ก่อนมีหลายเส้นทาง): ท่าเรือศรีราชาฮาร์เบอร์ → โกดัง ท่าเรือศรีราชาฮาร์เบอร์ · ลูกค้า BM · ตั๋วแบบศรีราชาฮาร์เบอร์
-- ไม่มีลูกค้า BM = เว้นว่าง ให้เลือกเองที่หน้า ตั้งค่า › ตั๋วเรือ
INSERT INTO "ShipRoute" ("folderName", "origin", "destination", "customerId", "format")
VALUES (
  'ท่าเรือศรีราชาฮาร์เบอร์ - โกดังท่าเรือศรีราชาฮาร์เบอร์',
  'ท่าเรือศรีราชาฮาร์เบอร์',
  'โกดัง ท่าเรือศรีราชาฮาร์เบอร์',
  (SELECT "id" FROM "Customer" WHERE UPPER(TRIM("code")) = 'BM' ORDER BY "id" LIMIT 1),
  'srh'
)
ON CONFLICT ("folderName") DO NOTHING;

-- รูปที่อ่านไปแล้วอ่านด้วยกฎของตั๋วแบบศรีราชาฮาร์เบอร์ — ไม่ต้องอ่านซ้ำ
UPDATE "ShipPhoto" SET "format" = 'srh';
