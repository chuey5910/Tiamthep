/**
 * แสดงรายชื่อบัญชีผู้ใช้ทั้งหมด — ใช้ตอนจำชื่อผู้ใช้ไม่ได้
 * (รหัสผ่านดูไม่ได้ เพราะเก็บแบบเข้ารหัสทางเดียว — ตั้งใหม่ด้วย set:password)
 *
 *   npm run list:users
 */
import { loadEnv } from "./load-env";
import { PrismaClient } from "@prisma/client";

loadEnv();
const prisma = new PrismaClient();

const ROLE: Record<string, string> = { ADMIN: "ผู้ดูแลระบบ", STAFF: "พนักงาน", VIEWER: "ดูอย่างเดียว" };
const STATUS: Record<string, string> = { ACTIVE: "ใช้งานได้", PENDING: "รออนุมัติ", SUSPENDED: "ถูกระงับ" };

async function main() {
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { username: true, name: true, role: true, status: true, lastLoginAt: true },
  });
  if (users.length === 0) {
    console.log("ยังไม่มีบัญชีผู้ใช้ — เปิดหน้าเว็บจะให้ตั้งบัญชีผู้ดูแลคนแรกเอง");
    return;
  }
  console.log(`บัญชีผู้ใช้ทั้งหมด ${users.length} บัญชี\n`);
  for (const u of users) {
    const last = u.lastLoginAt
      ? new Date(u.lastLoginAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })
      : "ยังไม่เคยเข้า";
    console.log(`  ${u.username.padEnd(16)} ${u.name}`);
    console.log(`  ${"".padEnd(16)} ${ROLE[u.role] ?? u.role} · ${STATUS[u.status] ?? u.status} · เข้าล่าสุด: ${last}\n`);
  }
  console.log("ลืมรหัสผ่าน:  npm run set:password -- <ชื่อผู้ใช้> <รหัสผ่านใหม่>");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
