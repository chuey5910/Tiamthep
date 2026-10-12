-- เส้นทางตั๋วเรือ: ท่าเรือศรีราชาฮาร์เบอร์ → จี เจ สตีล บ่อวิน (ตั๋วปลายทางของ จี เจ สตีล)
-- สถานที่ปลายทาง — เพิ่มเฉพาะเมื่อยังไม่มีในรายการตัวเลือก
INSERT INTO "Lookup" ("kind", "value", "sort")
SELECT 'location', 'จี เจ สตีล บ่อวิน', (SELECT COALESCE(MAX("sort"), 0) FROM "Lookup" WHERE "kind" = 'location') + 1
ON CONFLICT ("kind", "value") DO NOTHING;

-- ค่าตั้งของโฟลเดอร์เส้นทาง: ต้นทาง/ปลายทาง/แบบตั๋ว ตามที่เจ้าของกำหนด · ลูกค้าเว้นไว้ให้เลือกเอง (ไม่เดา)
-- มีแถวอยู่แล้ว (ระบบเพิ่มเองตอนเจอโฟลเดอร์) → ตั้งแบบตั๋ว และเติมต้นทาง/ปลายทางที่ยังว่าง ไม่ทับลูกค้าที่เลือกไว้
INSERT INTO "ShipRoute" ("folderName", "origin", "destination", "format")
VALUES ('ท่าเรือศรีราชาฮาร์เบอร์ - จี เจ สตีล บ่อวิน', 'ท่าเรือศรีราชาฮาร์เบอร์', 'จี เจ สตีล บ่อวิน', 'gjs')
ON CONFLICT ("folderName") DO UPDATE SET
  "format" = 'gjs',
  "origin" = COALESCE("ShipRoute"."origin", EXCLUDED."origin"),
  "destination" = COALESCE("ShipRoute"."destination", EXCLUDED."destination");
