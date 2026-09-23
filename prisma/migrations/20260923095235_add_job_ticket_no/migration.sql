-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "ticketDest" TEXT,
ADD COLUMN     "ticketOrigin" TEXT;

-- ย้ายเลขตั๋วที่เคยเก็บปนอยู่ในหมายเหตุ มาไว้ในช่องของตัวเอง
-- (งานที่ดึงจากชีตก่อนหน้านี้เขียนไว้เป็นข้อความ "ตั๋วต้นทาง XXX · ตั๋วปลายทาง YYY · หมายเหตุจริง")
UPDATE "Job"
SET "ticketOrigin" = substring("note" from 'ตั๋วต้นทาง ([^·]+)')
WHERE "note" LIKE '%ตั๋วต้นทาง %' AND "ticketOrigin" IS NULL;

UPDATE "Job"
SET "ticketDest" = substring("note" from 'ตั๋วปลายทาง ([^·]+)')
WHERE "note" LIKE '%ตั๋วปลายทาง %' AND "ticketDest" IS NULL;

-- ตัดข้อความตั๋วออกจากหมายเหตุ เหลือไว้เฉพาะหมายเหตุจริงที่ออฟฟิศพิมพ์
UPDATE "Job"
SET "note" = NULLIF(trim(both ' ·' from regexp_replace("note", 'ตั๋ว(ต้นทาง|ปลายทาง) [^·]*(· )?', '', 'g')), '')
WHERE "note" LIKE '%ตั๋วต้นทาง %' OR "note" LIKE '%ตั๋วปลายทาง %';

-- เก็บช่องว่างที่ค้างจากการตัดข้อความ
UPDATE "Job" SET "ticketOrigin" = NULLIF(trim("ticketOrigin"), '') WHERE "ticketOrigin" IS NOT NULL;
UPDATE "Job" SET "ticketDest"   = NULLIF(trim("ticketDest"), '')   WHERE "ticketDest" IS NOT NULL;
