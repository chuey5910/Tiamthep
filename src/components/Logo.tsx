/**
 * โลโก้ Tiamthep — ใช้ไฟล์ตัวจริงที่เจ้าของบริษัทส่งมาเท่านั้น
 *
 *   public/brand/tiamthep-logo.jpg  (1280 × 545 · sha256 ab61fa43…c562e)
 *
 * ⚠ ห้ามแก้ไข เปลี่ยนแปลง หรือปรับปรุงโลโก้เด็ดขาด (คำสั่งเจ้าของ)
 *   ห้ามวาดใหม่ ห้ามครอป ห้ามเปลี่ยนสี ห้ามบีบ/ยืดผิดสัดส่วน ห้ามแยกส่วน
 *   ปรับได้อย่างเดียวคือขนาดที่แสดง โดยคงสัดส่วนเดิม (กำหนดแค่ความกว้างหรือความสูงด้านเดียว)
 *   เดิมเคยวาดเลียนแบบด้วย SVG — หน้าตาไม่ตรงของจริง ใช้งานไม่ได้ จึงเลิกใช้แล้ว
 */

export const LOGO_SRC = "/brand/tiamthep-logo.jpg";
export const LOGO_WIDTH = 1280;
export const LOGO_HEIGHT = 545;

export function Logo({
  className,
  title = "Tiamthep — บริษัท เทียมเทพ ขนส่ง จำกัด",
}: {
  className?: string;
  title?: string;
}) {
  return (
    // ใช้ <img> ตรงๆ ไม่ผ่านตัวย่อรูปของ Next — ไฟล์ต้องออกไปเหมือนต้นฉบับทุกไบต์
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      alt={title}
      className={className}
      style={{ height: "auto", objectFit: "contain" }}
      draggable={false}
    />
  );
}
