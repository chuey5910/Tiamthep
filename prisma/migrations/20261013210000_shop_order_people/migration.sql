-- ใบสั่งงานร้าน: คนดำเนินการ / คนสั่ง (จากข้อความ #สั่ง แบบมีหัวข้อ)
ALTER TABLE "ShopOrder" ADD COLUMN "operatorName" TEXT;
ALTER TABLE "ShopOrder" ADD COLUMN "orderedBy" TEXT;
