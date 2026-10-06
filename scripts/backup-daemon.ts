/**
 * ตัวตั้งเวลาสำรองข้อมูล — ทำงานค้างไว้ในกล่อง tiamthep-backup
 *
 * ตารางสำรองตั้งได้ที่ BACKUP_DAYS + BACKUP_TIME ใน .env (ดู scripts/backup-schedule.ts)
 * ค่าตั้งต้น: ทุกวันอังคารและวันศุกร์ เวลา 00:00 น. (เวลาไทย — กล่องตั้ง TZ=Asia/Bangkok ไว้แล้ว)
 * นอกจากนี้ทุกครั้งที่สั่ง update บน NAS ระบบจะสำรองให้ก่อนเสมอ
 *
 * เก็บตก: NAS ปิดอยู่ตอนถึงเวลา รอบนั้นจะหายไปเฉยๆ
 * ตอนกล่องเริ่มทำงานจึงเทียบไฟล์สำรองล่าสุดกับ "รอบล่าสุดที่ควรเกิดขึ้นแล้ว" ถ้าเก่ากว่า จะสำรองให้ทันที
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { backupAndNotify } from "./backup-run";
import { describe, nextRun, prevRun, readSchedule } from "./backup-schedule";
import { loadEnv } from "./load-env";

loadEnv();

const DIR = process.env.BACKUP_DIR?.trim() || join(process.cwd(), "backup");
const SCHEDULE = readSchedule(process.env);
for (const w of SCHEDULE.warnings) console.warn(`⚠ ${w}`);

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
  console.log(`ตัวสำรองข้อมูลเริ่มทำงาน — สำรอง${describe(SCHEDULE)} (เวลาไทย) เก็บย้อนหลัง ${process.env.BACKUP_KEEP_DAYS ?? 30} วัน`);

  // เก็บตกรอบที่พลาดไปตอนเครื่องปิด — ไม่งั้นรอบนั้นจะไม่มีไฟล์สำรองเลยโดยไม่มีใครรู้
  const last = lastBackupAt();
  const due = prevRun(SCHEDULE, new Date());
  if (!last || last.getTime() < due.getTime()) {
    console.log(
      last
        ? `ไฟล์สำรองล่าสุดคือ ${clock(last)} — พลาดรอบ ${clock(due)} ไป สำรองให้ทันที`
        : "ยังไม่เคยมีไฟล์สำรอง — สำรองให้ทันที",
    );
    await backupAndNotify(true).catch((e) => console.error("สำรองรอบเก็บตกไม่สำเร็จ:", e));
  }

  for (;;) {
    const at = nextRun(SCHEDULE, new Date());
    console.log(`รอบถัดไป: ${clock(at)}`);
    // แบ่งการรอเป็นช่วงสั้นๆ — เครื่องหยุดชั่วคราว (sleep/resume) แล้วตัวจับเวลายาวจะเพี้ยน
    while (Date.now() < at.getTime()) {
      await new Promise((r) => setTimeout(r, Math.min(60_000, at.getTime() - Date.now())));
    }
    await backupAndNotify(true).catch((e) => console.error("สำรองไม่สำเร็จ:", e));
  }
}

main();
