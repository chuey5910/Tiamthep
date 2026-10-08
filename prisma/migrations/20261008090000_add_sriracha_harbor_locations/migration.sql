-- สถานที่ของงานตั๋วเรือ ศรีราชาฮาร์เบอร์ — เพิ่มเฉพาะที่ยังไม่มีในรายการตัวเลือก มีแล้วข้ามไป (ON CONFLICT)
INSERT INTO "Lookup" ("kind", "value", "sort")
SELECT 'location', v.value, (SELECT COALESCE(MAX("sort"), 0) FROM "Lookup" WHERE "kind" = 'location') + v.n
FROM (VALUES
  (1, 'ท่าเรือศรีราชาฮาร์เบอร์'),
  (2, 'โกดัง ท่าเรือศรีราชาฮาร์เบอร์')
) AS v(n, value)
ON CONFLICT ("kind", "value") DO NOTHING;
