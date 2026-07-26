/**
 * ตัวช่วยเรื่องวันที่ — ทุกวันที่ในระบบเก็บเป็น UTC เที่ยงคืน
 * เพื่อให้เปรียบเทียบช่วงวันได้ตรงเป๊ะ ไม่เพี้ยนตาม timezone ของเครื่อง
 */

/** สร้าง Date ที่เวลา 00:00 UTC จากปี/เดือน/วัน */
export function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

/** ตัดเวลาออก เหลือแต่วันที่ (00:00 UTC) */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** วันแรกของเดือน */
export function startOfMonth(y: number, m: number): Date {
  return utcDate(y, m, 1);
}

/** วันสุดท้ายของเดือน */
export function endOfMonth(y: number, m: number): Date {
  return new Date(Date.UTC(y, m, 0));
}

/** จำนวนวันในเดือน */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** บวก/ลบเดือน โดยรักษาวันที่ไว้ (ตัดลงถ้าเดือนปลายทางสั้นกว่า) */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const day = Math.min(d.getUTCDate(), daysInMonth(y + Math.floor(m / 12), ((m % 12) + 12) % 12 + 1));
  return new Date(Date.UTC(y, m, day));
}

/** แปลง Date เป็น "YYYY-MM-DD" สำหรับ <input type="date"> */
export function toInputDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * แปลงข้อความวันที่เป็น Date (00:00 UTC)
 * รองรับ: "YYYY-MM-DD", "DD/MM/YYYY" และปี พ.ศ. (เช่น 31/03/2570 → 2027-03-31)
 * ปีที่มากกว่า 2400 ถือว่าเป็น พ.ศ. จึงลบ 543
 */
export function parseDate(input: unknown): Date | null {
  if (input == null || input === "" || input === "-") return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : startOfDay(input);
  if (typeof input === "number") {
    // เลข serial ของ Excel (นับจาก 1899-12-30)
    const ms = Math.round((input - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : startOfDay(d);
  }
  const s = String(input).trim();
  if (!s || s === "-") return null;

  // YYYY-MM-DD (อาจมีเวลาต่อท้าย)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return normalizeYear(+m[1], +m[2], +m[3]);

  // DD/MM/YYYY หรือ DD-MM-YYYY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return normalizeYear(+m[3], +m[2], +m[1]);

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : startOfDay(d);
}

function normalizeYear(y: number, m: number, d: number): Date | null {
  // ปี พ.ศ. → ค.ศ.
  if (y > 2400) y -= 543;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = utcDate(y, m, d);
  return isNaN(dt.getTime()) ? null : dt;
}

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

export const TH_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** แสดงวันที่แบบไทย เช่น "5 ก.ค. 2569" (ปี พ.ศ.) */
export function formatThaiDate(d: Date | null | undefined): string {
  if (!d) return "";
  return `${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

/** อายุรถ/ระยะเวลา เป็นข้อความ "X ปี Y เดือน" */
export function formatAge(from: Date | null | undefined, to: Date = new Date()): string {
  if (!from) return "";
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  let months = to.getUTCMonth() - from.getUTCMonth();
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  if (years < 0) return "";
  return `${years} ปี ${months} เดือน`;
}

/** จำนวนวันคงเหลือจนถึงวันที่กำหนด (ติดลบ = เลยมาแล้ว) */
export function daysUntil(d: Date | null | undefined, today: Date = new Date()): number | null {
  if (!d) return null;
  const a = startOfDay(d).getTime();
  const b = startOfDay(today).getTime();
  return Math.round((a - b) / 86400000);
}

export type DocStatus = "ปกติ" | "ใกล้หมดอายุ" | "หมดอายุ!" | "ยังไม่กรอกวันที่";

/** สถานะเอกสารตามจำนวนวันแจ้งเตือนล่วงหน้า */
export function docStatus(d: Date | null | undefined, alertDays: number, today: Date = new Date()): DocStatus {
  if (!d) return "ยังไม่กรอกวันที่";
  const n = daysUntil(d, today)!;
  if (n < 0) return "หมดอายุ!";
  if (n <= alertDays) return "ใกล้หมดอายุ";
  return "ปกติ";
}

/** ช่วงงวดเบี้ยเลี้ยง: งวด 1 = วันที่ 1-15, งวด 2 = วันที่ 16-สิ้นเดือน */
export function payPeriod(year: number, month: number, period: 1 | 2): { from: Date; to: Date } {
  return period === 1
    ? { from: utcDate(year, month, 1), to: utcDate(year, month, 15) }
    : { from: utcDate(year, month, 16), to: endOfMonth(year, month) };
}
