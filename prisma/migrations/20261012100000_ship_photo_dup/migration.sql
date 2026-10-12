-- รูปซ้ำ (สำเนาของรูปที่อ่านแล้ว) — ชี้ไปที่ fileId ของรูปเดิม ไม่สร้างตั๋ว
-- AlterTable
ALTER TABLE "ShipPhoto" ADD COLUMN     "dupOf" TEXT;

