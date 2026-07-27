/**
 * โลโก้ Tiamthep ตาม CI: ตัวอักษรเอียงหนาสีดำ จุด i สีแดง
 * และเส้นโค้ง (swoosh) สีแดงกวาดไปทางขวา
 *
 * เคล็ดลับจุด i สีแดง: วาดตัว "Ti" สีแดงไว้ชั้นล่าง (ซ่อน T)
 * แล้วทับด้วย "Tıamthep" (ı ไม่มีจุด) สีดำ — ก้านตัว i สีแดงจึงถูก
 * ก้าน ı ดำทับสนิท เหลือโผล่เฉพาะจุดสีแดงด้านบน ตรงตำแหน่งเป๊ะ
 * ไม่ว่าเครื่องผู้ใช้จะมีฟอนต์ไหน
 */

const RED = "#e51c23";
const EN_FONT =
  'italic 800 64px "Myriad Pro", "Helvetica Neue", Helvetica, Arial, sans-serif';
const TH_FONT =
  '600 26px "Sukhumvit Set", "IBM Plex Sans Thai", "Leelawadee UI", "Thonburi", sans-serif';

export function Logo({
  className,
  withThai = true,
  title = "Tiamthep — บริษัท เทียมเทพ ขนส่ง จำกัด",
}: {
  className?: string;
  withThai?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox={withThai ? "0 0 430 150" : "0 0 430 112"}
      className={className}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* swoosh แดง — โค้งจากบนซ้าย กวาดขวาเป็นหัวลูกศร หางม้วนกลับใต้ตัวอักษร */}
      <path
        fill={RED}
        d="M148 18
           C 238 -10, 350 0, 416 48
           L 428 62
           C 398 96, 336 112, 258 104
           C 330 102, 378 86, 397 60
           C 360 28, 252 10, 148 18 Z"
      />
      {/* ชั้นล่าง: Ti สีแดง (T โปร่งใส) — เหลือให้เห็นเฉพาะจุดของ i */}
      <text x="8" y="86" style={{ font: EN_FONT, letterSpacing: "-1px" }}>
        <tspan opacity="0">T</tspan>
        <tspan fill={RED}>i</tspan>
      </text>
      {/* ชั้นบน: ชื่อเต็มด้วย ı ไม่มีจุด สีดำ */}
      <text x="8" y="86" fill="#0a0a0a" style={{ font: EN_FONT, letterSpacing: "-1px" }}>
        Tıamthep
      </text>
      {withThai && (
        <text x="10" y="132" fill="#3f3f42" style={{ font: TH_FONT }}>
          บริษัท เทียมเทพ ขนส่ง จำกัด
        </text>
      )}
    </svg>
  );
}
