/**
 * ตั้งรหัสผ่านใหม่ให้ผู้ใช้ที่มีอยู่ — ใช้กรณีลืมรหัสผ่านแต่ไม่อยากล้างบัญชี
 *
 *   npm run set:password -- <ชื่อผู้ใช้> <รหัสผ่านใหม่>
 *   เช่น  npm run set:password -- adisak MyNewPass123
 *
 * ไม่ลบข้อมูลใดๆ · ปลดล็อกบัญชีให้ด้วย · ตัดเซสชันเก่าทุกเครื่อง
 * ดูรายชื่อผู้ใช้ทั้งหมด: npm run list:users
 */
import { loadEnv } from "./load-env";
import { PrismaClient } from "@prisma/client";
import { hashPassword, checkPasswordStrength, normalizeUsername } from "../src/lib/auth";

loadEnv();
const prisma = new PrismaClient();

async function main() {
  const [username, password] = process.argv.slice(2).filter((a) => a !== "--");
  if (!username || !password) {
    console.log("วิธีใช้:  npm run set:password -- <ชื่อผู้ใช้> <รหัสผ่านใหม่>");
    console.log("ดูรายชื่อผู้ใช้:  npm run list:users");
    process.exit(1);
  }

  const problem = checkPasswordStrength(password);
  if (problem) {
    console.log("รหัสผ่านใช้ไม่ได้:", problem);
    process.exit(1);
  }

  const uname = normalizeUsername(username);
  const user = await prisma.user.findUnique({ where: { username: uname } });
  if (!user) {
    console.log(`ไม่พบผู้ใช้ "${uname}" — ดูรายชื่อทั้งหมดด้วย: npm run list:users`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      failedLogins: 0,
      lockedUntil: null,
      // บัญชีที่ถูกระงับไม่ปลุกให้ — ต้องไปเปิดที่หน้าจัดการผู้ใช้เอง
    },
  });
  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.loginLog.create({
    data: {
      action: "PASSWORD_CHANGE",
      username: uname,
      userId: user.id,
      success: true,
      reason: "ตั้งรหัสผ่านใหม่จาก command line บนเครื่องเซิร์ฟเวอร์",
    },
  });

  console.log(`✓ ตั้งรหัสผ่านใหม่ให้ "${uname}" (${user.name}) แล้ว`);
  console.log(`  สิทธิ์: ${user.role} · สถานะ: ${user.status}`);
  if (user.status !== "ACTIVE") {
    console.log("  ⚠ บัญชีนี้ไม่ได้อยู่ในสถานะใช้งาน — เข้าระบบไม่ได้จนกว่าจะเปิดใช้งาน");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
