-- เพิ่มรหัสอ้างอิงจากชีตสั่งงานไลน์ — unique กันนำเข้างานเดิมซ้ำ
ALTER TABLE "Job" ADD COLUMN "sheetRef" TEXT;

CREATE UNIQUE INDEX "Job_sheetRef_key" ON "Job"("sheetRef");
