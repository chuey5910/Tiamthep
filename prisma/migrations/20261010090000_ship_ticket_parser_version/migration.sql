-- รุ่นตัวอ่านตั๋วเรือ — ของเดิมเป็นรุ่น 1 รูปที่ยังรอตรวจทั้งรูปจะถูกอ่านใหม่เองรอบดึงถัดไป
-- AlterTable
ALTER TABLE "ShipTicket" ADD COLUMN     "parserVersion" INTEGER NOT NULL DEFAULT 1;

