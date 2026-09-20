/**
 * เรียงชื่อแบบ "ไทยก่อน อังกฤษทีหลัง"
 *
 * ฐานข้อมูลเรียงตามรหัสตัวอักษร (A-Z มาก่อน ก-ฮ เสมอ) ทำให้ชื่อไทยไปกองท้ายรายการ
 * คนกรอกงานต้องเลื่อนผ่านชื่ออังกฤษทั้งหมดก่อนถึงจะเจอชื่อไทย จึงเรียงใหม่ในโค้ด
 *
 * ภายในกลุ่มเดียวกันใช้กฎการเรียงของภาษาไทย (เช่น เ-, แ-, ไ- เรียงถูกตามพจนานุกรม)
 * และตัวเลขเรียงตามค่า ไม่ใช่ตามตัวอักษร ("รถ 2" มาก่อน "รถ 10")
 */

/** ขึ้นต้นด้วยอักษรไทยไหม (รวมสระหน้าอย่าง เ แ โ ใ ไ ซึ่งอยู่ในช่วงเดียวกัน) */
const startsThai = (s: string) => /^[฀-๿]/.test(s.trim());

export function compareThaiFirst(a: string, b: string): number {
  const at = startsThai(a);
  const bt = startsThai(b);
  if (at !== bt) return at ? -1 : 1;
  // numeric: ตัวเลขในชื่อเรียงตามค่า — "กม. 2" มาก่อน "กม. 10"
  return a.localeCompare(b, "th", { numeric: true });
}

/** เรียงรายการตัวเลือก (value/label) แบบไทยก่อน — ใช้ label เป็นตัวเทียบ */
export function sortOptionsThaiFirst<T extends { label: string }>(options: T[]): T[] {
  return [...options].sort((a, b) => compareThaiFirst(a.label, b.label));
}
