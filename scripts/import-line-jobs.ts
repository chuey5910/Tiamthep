/**
 * ดึงงานจากชีตสั่งงานไลน์เข้าฐานข้อมูล — แบบสั่งจากเครื่อง (ไม่ต้องเปิดเว็บ)
 *
 *   npm run sheet:import
 *
 * ใช้ตรรกะเดียวกับปุ่ม «ดึงงานเข้าเว็บ» ในหน้า งานจากไลน์ ทุกประการ
 * เรียกซ้ำได้เสมอ ไม่เกิดข้อมูลซ้ำ — จะตั้งเป็นงานอัตโนมัติรายชั่วโมงบน CHUEY-Server ก็ได้
 * (ดูวิธีตั้ง launchd ใน line-bot/README.md)
 */

import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  // import หลัง loadEnv เพื่อให้ prisma เห็น DATABASE_URL
  const { runSheetImport } = await import("../src/lib/sheet-jobs");
  const res = await runSheetImport();

  if (!res.ok) {
    console.error("❌ " + res.error);
    process.exitCode = 1;
    return;
  }

  console.log(`นำเข้าสำเร็จ ${res.imported} งาน · ไม่ผ่าน ${res.failed} งาน · รอออฟฟิศยืนยันอีก ${res.pendingReview} งาน`);
  for (const r of res.rows) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.jobId} — ${r.message}`);
  }
}

main().then(() => process.exit());
