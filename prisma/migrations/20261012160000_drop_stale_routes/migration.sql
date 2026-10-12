-- ค่าตั้งเส้นทางที่ค้างจากชื่อโฟลเดอร์เก่า — ชื่อต่างจากเส้นทางอื่นแค่ช่องว่าง (เช่น «โกดังท่าเรือ…» กับ «โกดัง ท่าเรือ…»)
-- ลบเฉพาะแถวที่ยังไม่ได้เลือกลูกค้า และไม่มีรูป/ตั๋วอ้างถึงเลย — แถวที่ใช้อยู่ไม่แตะ
DELETE FROM "ShipRoute" r
WHERE r."customerId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "ShipPhoto" p WHERE p."routeFolder" = r."folderName")
  AND NOT EXISTS (SELECT 1 FROM "ShipTicket" t WHERE t."routeFolder" = r."folderName")
  AND EXISTS (
    SELECT 1 FROM "ShipRoute" x
    WHERE x."id" <> r."id"
      AND regexp_replace(x."folderName", '\s', '', 'g') = regexp_replace(r."folderName", '\s', '', 'g')
  );
