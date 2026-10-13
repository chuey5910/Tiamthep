-- โฟลเดอร์เส้นทางที่อ่านครบแล้ว หยุดอ่าน · เก็บผลตัวอ่านที่สองไว้ ไม่ต้องอ่านรูปซ้ำทุกครั้งที่อัปเดต
ALTER TABLE "ShipRoute" ADD COLUMN "readStopped" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShipRoute" ADD COLUMN "readStoppedAt" TIMESTAMP(3);
ALTER TABLE "ShipPhoto" ADD COLUMN "localResult" JSONB;
ALTER TABLE "ShipPhoto" ADD COLUMN "localVersion" INTEGER NOT NULL DEFAULT 0;
