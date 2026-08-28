-- เพิ่มรหัสอ้างอิงจากชีตสั่งงานไลน์ในตารางเงินเดินทาง — unique กันนำเข้าซ้ำ
ALTER TABLE "TravelAdvance" ADD COLUMN "sheetRef" TEXT;

CREATE UNIQUE INDEX "TravelAdvance_sheetRef_key" ON "TravelAdvance"("sheetRef");
