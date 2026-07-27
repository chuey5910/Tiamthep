-- เติมชื่อ พขร. ที่มีอยู่แล้วเข้าทะเบียนพนักงาน (สิทธิ์สมัครใช้งานเว็บ)
-- สำหรับเครื่องที่อัปเดตจากเวอร์ชันก่อนมีตาราง Employee — ติดตั้งใหม่ seed จัดการให้อยู่แล้ว
-- ชื่อซ้ำกับที่มีอยู่จะถูกข้าม ไม่ทับข้อมูลเดิม
INSERT INTO "Employee" ("name", "position")
SELECT DISTINCT regexp_replace(btrim("firstName" || ' ' || "lastName"), '\s+', ' ', 'g'),
       'พนักงานขับรถ (พขร.)'
FROM "Driver"
WHERE btrim("firstName" || ' ' || "lastName") <> ''
ON CONFLICT ("name") DO NOTHING;
