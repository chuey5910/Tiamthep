-- หมวดสินค้าในคลัง: รวมหมวดเก่าเป็น 8 หมวด (เจ้าของตกลง 17 ต.ค. 2569 · นิยามอยู่ที่ src/lib/stock-groups.ts)
-- เปลี่ยนเฉพาะ "ชื่อหมวด" ของสินค้า — รหัสสินค้า สต็อก รับเข้า/เบิกใช้ ไม่แตะ
-- หมวดที่ไม่อยู่ในรายการด้านล่าง (ถ้ามีในเครื่องจริง) ไม่เปลี่ยน — ให้คนจัดเอง
UPDATE "InventoryItem" SET "category" = CASE "category"
  WHEN 'น้ำมันเครื่อง'  THEN 'ของเหลว'
  WHEN 'ไฟ'           THEN 'ไฟฟ้า'
  WHEN 'แบตเตอรี่'      THEN 'ไฟฟ้า'
  WHEN 'ยาง'          THEN 'ยางและกระทะล้อ'
  WHEN 'น็อตล้อ'        THEN 'ยางและกระทะล้อ'
  WHEN 'ซีลและลูกปืน'    THEN 'ช่วงล่าง'
  WHEN 'ผ้าเบรค'        THEN 'ช่วงล่าง'
  WHEN 'แผ่นครัช'        THEN 'ช่วงล่าง'
  WHEN 'ชุดข้อต่อ'       THEN 'ข้อต่อและระบบลม'
  ELSE "category" END
WHERE "category" IN ('น้ำมันเครื่อง', 'ไฟ', 'แบตเตอรี่', 'ยาง', 'น็อตล้อ', 'ซีลและลูกปืน', 'ผ้าเบรค', 'แผ่นครัช', 'ชุดข้อต่อ');

-- รายการตัวเลือกหมวด = 8 หมวด เรียงตามนี้
INSERT INTO "Lookup" ("kind", "value", "sort") VALUES
  ('stockCategory', 'ของเหลว', 1),
  ('stockCategory', 'ช่วงล่าง', 2),
  ('stockCategory', 'ข้อต่อและระบบลม', 3),
  ('stockCategory', 'ไฟฟ้า', 4),
  ('stockCategory', 'ยางและกระทะล้อ', 5),
  ('stockCategory', 'อุปกรณ์ดัมพ์', 6),
  ('stockCategory', 'กรอง', 7),
  ('stockCategory', 'ทั่วไป', 8)
ON CONFLICT ("kind", "value") DO UPDATE SET "sort" = EXCLUDED."sort";

-- ตัวเลือกหมวดเก่าที่ไม่มีสินค้าใช้แล้ว เอาออก (ที่ยังมีสินค้าใช้อยู่ เก็บไว้)
DELETE FROM "Lookup"
WHERE "kind" = 'stockCategory'
  AND "value" NOT IN ('ของเหลว', 'ช่วงล่าง', 'ข้อต่อและระบบลม', 'ไฟฟ้า', 'ยางและกระทะล้อ', 'อุปกรณ์ดัมพ์', 'กรอง', 'ทั่วไป')
  AND "value" NOT IN (SELECT DISTINCT "category" FROM "InventoryItem" WHERE "category" IS NOT NULL);
