-- เส้นทางตั๋วเรือ: ท่าเรือศรีราชาฮาร์เบอร์ → จี สตีล บ้านค่าย (ตั๋วปลายทางของ จี สตีล)
-- + ลูกค้าของ 2 เส้นทางโรงงานเหล็ก = AST ตามที่เจ้าของกำหนด

-- 1. ชื่อโฟลเดอร์เส้นทางแบบมาตรฐาน «ต้นทาง - ปลายทาง» (ใน Drive บางโฟลเดอร์เขียนขีดติดกัน)
--    ต้องตรงกับ normRouteFolder() ใน src/lib/ship-ticket.ts
--    มีทั้งชื่อเดิมและชื่อมาตรฐาน → เก็บแถวชื่อมาตรฐาน ลบแถวชื่อเดิม
DELETE FROM "ShipRoute" r
WHERE r."folderName" <> regexp_replace(regexp_replace(trim(r."folderName"), '\s+', ' ', 'g'), '\s*-\s*', ' - ')
  AND EXISTS (
    SELECT 1 FROM "ShipRoute" x
    WHERE x."folderName" = regexp_replace(regexp_replace(trim(r."folderName"), '\s+', ' ', 'g'), '\s*-\s*', ' - ')
  );
UPDATE "ShipRoute" SET "folderName" = regexp_replace(regexp_replace(trim("folderName"), '\s+', ' ', 'g'), '\s*-\s*', ' - ');
UPDATE "ShipTicket" SET "routeFolder" = regexp_replace(regexp_replace(trim("routeFolder"), '\s+', ' ', 'g'), '\s*-\s*', ' - ');
UPDATE "ShipPhoto" SET "routeFolder" = regexp_replace(regexp_replace(trim("routeFolder"), '\s+', ' ', 'g'), '\s*-\s*', ' - ');

-- 2. สถานที่ปลายทาง — เพิ่มเฉพาะเมื่อยังไม่มีในรายการตัวเลือก
INSERT INTO "Lookup" ("kind", "value", "sort")
SELECT 'location', 'จี สตีล บ้านค่าย', (SELECT COALESCE(MAX("sort"), 0) FROM "Lookup" WHERE "kind" = 'location') + 1
ON CONFLICT ("kind", "value") DO NOTHING;

-- 3. ค่าตั้งโฟลเดอร์ จี สตีล บ้านค่าย: ต้นทาง/ปลายทาง/แบบตั๋ว (มีแถวแล้ว → ตั้งแบบตั๋ว เติมต้นทาง/ปลายทางที่ว่าง)
INSERT INTO "ShipRoute" ("folderName", "origin", "destination", "format")
VALUES ('ท่าเรือศรีราชาฮาร์เบอร์ - จี สตีล บ้านค่าย', 'ท่าเรือศรีราชาฮาร์เบอร์', 'จี สตีล บ้านค่าย', 'gs')
ON CONFLICT ("folderName") DO UPDATE SET
  "format" = 'gs',
  "origin" = COALESCE("ShipRoute"."origin", EXCLUDED."origin"),
  "destination" = COALESCE("ShipRoute"."destination", EXCLUDED."destination");

-- 4. ลูกค้า AST ทั้ง 2 เส้นทาง (ไม่มีลูกค้ารหัส AST = เว้นว่าง ให้เลือกเองที่หน้า ตั้งค่า › ตั๋วเรือ)
UPDATE "ShipRoute"
SET "customerId" = COALESCE((SELECT "id" FROM "Customer" WHERE UPPER(TRIM("code")) = 'AST' ORDER BY "id" LIMIT 1), "customerId")
WHERE "folderName" IN ('ท่าเรือศรีราชาฮาร์เบอร์ - จี เจ สตีล บ่อวิน', 'ท่าเรือศรีราชาฮาร์เบอร์ - จี สตีล บ้านค่าย');
