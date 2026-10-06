/**
 * ตารางเวลาสำรองข้อมูล — แยกเป็นฟังก์ชันล้วน ทดสอบได้โดยไม่ต้องรอเวลาจริง
 *
 * ตั้งใน .env:
 *   BACKUP_DAYS=อังคาร,ศุกร์   วันที่สำรอง (ค่าตั้งต้น) — ใช้ชื่อไทย ตัวย่อ (อ. ศ.) อังกฤษ (tue fri)
 *                              ตัวเลข 0-6 (0 = อาทิตย์) หรือ "ทุกวัน" ก็ได้
 *   BACKUP_TIME=00:00         เวลาที่สำรอง (ค่าตั้งต้น) — หลายเวลาคั่นด้วยจุลภาค
 *
 * BACKUP_TIMES (ตัวเก่า สำรองทุกวัน 00:00 และ 12:15) เลิกใช้แล้ว — ถ้ายังค้างอยู่ใน .env จะไม่สนใจ
 * และบอกให้รู้ ไม่งั้นไฟล์ .env เก่าบน NAS จะทำให้ระบบสำรองตามตารางเดิมเงียบๆ
 */

export type Schedule = { days: number[]; times: { h: number; m: number }[]; warnings: string[] };

const DAY_NAMES: Record<string, number> = {
  อาทิตย์: 0, "อา.": 0, อา: 0, sun: 0, sunday: 0,
  จันทร์: 1, "จ.": 1, จ: 1, mon: 1, monday: 1,
  อังคาร: 2, "อ.": 2, อ: 2, tue: 2, tuesday: 2,
  พุธ: 3, "พ.": 3, พ: 3, wed: 3, wednesday: 3,
  พฤหัสบดี: 4, พฤหัส: 4, "พฤ.": 4, พฤ: 4, thu: 4, thursday: 4,
  ศุกร์: 5, "ศ.": 5, ศ: 5, fri: 5, friday: 5,
  เสาร์: 6, "ส.": 6, ส: 6, sat: 6, saturday: 6,
};
export const THAI_DAY = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

const DEFAULT_DAYS = [2, 5]; // อังคาร, ศุกร์
const DEFAULT_TIMES = [{ h: 0, m: 0 }];

export function readSchedule(env: Record<string, string | undefined>): Schedule {
  const warnings: string[] = [];

  // ── วัน ──
  const rawDays = (env.BACKUP_DAYS ?? "").trim();
  let days: number[] = [];
  if (!rawDays) days = DEFAULT_DAYS;
  else if (/^(ทุกวัน|daily|everyday)$/i.test(rawDays)) days = [0, 1, 2, 3, 4, 5, 6];
  else {
    for (const part of rawDays.split(",")) {
      const t = part.trim().toLowerCase();
      if (!t) continue;
      const n = /^[0-6]$/.test(t) ? Number(t) : DAY_NAMES[t];
      if (n === undefined) warnings.push(`วัน "${part.trim()}" ใน BACKUP_DAYS อ่านไม่ออก — ใช้ชื่อวันไทย เช่น อังคาร,ศุกร์`);
      else if (!days.includes(n)) days.push(n);
    }
    if (days.length === 0) {
      warnings.push("BACKUP_DAYS ไม่มีวันที่ใช้ได้เลย — ใช้ค่าตั้งต้น อังคาร,ศุกร์");
      days = DEFAULT_DAYS;
    }
  }

  // ── เวลา ──
  const rawTimes = (env.BACKUP_TIME ?? "").trim();
  if (env.BACKUP_TIMES?.trim()) {
    warnings.push(`BACKUP_TIMES=${env.BACKUP_TIMES.trim()} เลิกใช้แล้ว ไม่มีผล — ตอนนี้ใช้ BACKUP_DAYS + BACKUP_TIME (ลบบรรทัดนั้นออกจาก .env ได้)`);
  }
  const times: { h: number; m: number }[] = [];
  for (const part of (rawTimes || "00:00").split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d{1,2})[:.](\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) {
      warnings.push(`เวลา "${t}" ใน BACKUP_TIME ใช้ไม่ได้ — ต้องเป็นรูปแบบ HH:MM เช่น 00:00`);
      continue;
    }
    times.push({ h: +m[1], m: +m[2] });
  }
  return {
    days: days.sort((a, b) => a - b),
    times: (times.length ? times : DEFAULT_TIMES).sort((a, b) => a.h - b.h || a.m - b.m),
    warnings,
  };
}

const hhmm = (t: { h: number; m: number }) => `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`;

export function describe(s: Schedule): string {
  const d = s.days.length === 7 ? "ทุกวัน" : `ทุกวัน${s.days.map((n) => THAI_DAY[n]).join(" และวัน")}`;
  return `${d} เวลา ${s.times.map(hhmm).join(" และ ")} น.`;
}

/** รอบถัดไปที่อยู่หลังเวลาที่ให้มา (เวลาท้องถิ่นของกล่อง = เวลาไทย) */
export function nextRun(s: Schedule, after: Date): Date {
  for (let add = 0; add <= 7; add++) {
    const day = new Date(after);
    day.setDate(day.getDate() + add);
    if (!s.days.includes(day.getDay())) continue;
    for (const t of s.times) {
      const at = new Date(day);
      at.setHours(t.h, t.m, 0, 0);
      if (at.getTime() > after.getTime()) return at;
    }
  }
  throw new Error("หารอบถัดไปไม่เจอ — ตารางสำรองว่าง");
}

/** รอบล่าสุดที่ควรเกิดขึ้นแล้ว (≤ เวลาที่ให้มา) — ใช้ตัดสินว่าพลาดรอบไปหรือยัง */
export function prevRun(s: Schedule, before: Date): Date {
  for (let sub = 0; sub <= 7; sub++) {
    const day = new Date(before);
    day.setDate(day.getDate() - sub);
    if (!s.days.includes(day.getDay())) continue;
    for (const t of [...s.times].reverse()) {
      const at = new Date(day);
      at.setHours(t.h, t.m, 0, 0);
      if (at.getTime() <= before.getTime()) return at;
    }
  }
  throw new Error("หารอบก่อนหน้าไม่เจอ — ตารางสำรองว่าง");
}
