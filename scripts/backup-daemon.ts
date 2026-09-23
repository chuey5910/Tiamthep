/**
 * ตัวตั้งเวลาสำรองข้อมูล — ทำงานค้างไว้ในกล่อง tiamthep-backup
 *
 * เวลาที่สำรอง ตั้งได้ที่ BACKUP_TIMES ใน .env (ค่าตั้งต้น 00:00 และ 12:15 เวลาไทย)
 * กล่องตั้ง TZ=Asia/Bangkok ไว้แล้ว เวลาในกล่องจึงเป็นเวลาไทยตรงๆ
 *
 * เก็บตก: NAS ปิดอยู่ตอนถึงเวลา รอบนั้นจะหายไปเฉยๆ
 * ตอนกล่องเริ่มทำงานจึงดูไฟล์สำรองล่าสุด ถ้าเก่ากว่าช่วงห่างของรอบ จะสำรองให้ทันที
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { backupAndNotify } from "./backup-run";
import { loadEnv } from "./load-env";

loadEnv();

const DIR = process.env.BACKUP_DIR?.trim() || join(process.cwd(), "backup");

/** อ่านเวลาจาก .env — รูปแบบ "HH:MM,HH:MM" ค่าที่ผิดรูปจะถูกข้ามไปพร้อมบอกให้รู้ */
function scheduleTimes(): { h: number; m: number }[] {
  const raw = (process.env.BACKUP_TIMES ?? "00:00,12:15").split(",");
  const out: { h: number; m: number }[] = [];
  for (const item of raw) {
    const t = item.trim();
    if (!t) continue;
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) {
      console.warn(`⚠ เวลา "${t}" ใน BACKUP_TIMES ใช้ไม่ได้ — ต้องเป็นรูปแบบ HH:MM เช่น 12:15`);
      continue;
    }
    out.push({ h: +m[1], m: +m[2] });
  }
  if (out.length === 0) out.push({ h: 0, m: 0 }, { h: 12, m: 15 });
  return out.sort((a, b) => a.h - b.h || a.m - b.m);
}

const TIMES = scheduleTimes();
const label = TIMES.map((t) => `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`).join(" และ ");

/** เวลารอบถัดไปหลังจากเวลาที่ให้มา */
function nextRun(after: Date): Date {
  for (const t of TIMES) {
    const d = new Date(after);
    d.setHours(t.h, t.m, 0, 0);
    if (d.getTime() > after.getTime()) return d;
  }
  const d = new Date(after);
  d.setDate(d.getDate() + 1);
  d.setHours(TIMES[0].h, TIMES[0].m, 0, 0);
  return d;
}

/** ช่วงห่างที่สั้นที่สุดระหว่างสองรอบ (มิลลิวินาที) — ใช้ตัดสินว่าพลาดรอบไปหรือยัง */
function shortestGapMs(): number {
  if (TIMES.length < 2) return 24 * 3600_000;
  const mins = TIMES.map((t) => t.h * 60 + t.m);
  let min = 24 * 60 - mins[mins.length - 1] + mins[0];
  for (let i = 1; i < mins.length; i++) min = Math.min(min, mins[i] - mins[i - 1]);
  return min * 60_000;
}

/** เวลาไฟล์สำรองล่าสุดในเครื่อง (null = ยังไม่เคยมี) */
function lastBackupAt(): Date | null {
  if (!existsSync(DIR)) return null;
  let newest = 0;
  for (const name of readdirSync(DIR)) {
    if (!name.startsWith("tiamthep-") || !name.endsWith(".sql.gz")) continue;
    newest = Math.max(newest, statSync(join(DIR, name)).mtimeMs);
  }
  return newest ? new Date(newest) : null;
}

const clock = (d: Date) => d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

async function main(): Promise<void> {
  console.log(`ตัวสำรองข้อมูลเริ่มทำงาน — สำรองทุกวันเวลา ${label} (เวลาไทย) เก็บย้อนหลัง ${process.env.BACKUP_KEEP_DAYS ?? 30} วัน`);

  // เก็บตกรอบที่พลาดไปตอนเครื่องปิด — ไม่งั้นวันนั้นจะไม่มีไฟล์สำรองเลยโดยไม่มีใครรู้
  const last = lastBackupAt();
  const gap = shortestGapMs();
  if (!last || Date.now() - last.getTime() > gap) {
    console.log(last ? `ไฟล์สำรองล่าสุดคือ ${clock(last)} — เก่ากว่ารอบที่ควรจะเป็น สำรองให้ทันที` : "ยังไม่เคยมีไฟล์สำรอง — สำรองให้ทันที");
    await backupAndNotify(true).catch((e) => console.error("สำรองรอบเก็บตกไม่สำเร็จ:", e));
  }

  for (;;) {
    const at = nextRun(new Date());
    console.log(`รอบถัดไป: ${clock(at)}`);
    // แบ่งการรอเป็นช่วงสั้นๆ — เครื่องหยุดชั่วคราว (sleep/resume) แล้วตัวจับเวลายาวจะเพี้ยน
    while (Date.now() < at.getTime()) {
      await new Promise((r) => setTimeout(r, Math.min(60_000, at.getTime() - Date.now())));
    }
    await backupAndNotify(true).catch((e) => console.error("สำรองไม่สำเร็จ:", e));
  }
}

main();
