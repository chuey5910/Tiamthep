/**
 * ล้างบัญชีผู้ใช้ทั้งหมด เพื่อกลับไปตั้งบัญชีผู้ดูแลใหม่ผ่านหน้าเว็บ
 * (ใช้กรณีลืมรหัสผ่านผู้ดูแล หรืออยากเริ่มตั้งค่าผู้ใช้ใหม่ทั้งหมด)
 *
 *   npm run reset:users -- --yes
 *
 * ลบเฉพาะบัญชีและ session — ข้อมูลงานขนส่ง รายงาน และบันทึกการเข้าระบบยังอยู่ครบ
 * เปิดเว็บครั้งถัดไปจะเข้าหน้า "ตั้งค่าครั้งแรก" ให้สร้างผู้ดูแลใหม่เอง
 */
import "./load-env";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (!process.argv.includes("--yes")) {
    console.log("คำสั่งนี้จะลบบัญชีผู้ใช้ทั้งหมด (ข้อมูลงานขนส่งไม่หาย)");
    console.log("ยืนยันด้วย:  npm run reset:users -- --yes");
    process.exit(1);
  }

  const users = await prisma.user.findMany({ select: { username: true } });
  if (users.length === 0) {
    console.log("ยังไม่มีบัญชีผู้ใช้ในระบบอยู่แล้ว");
    return;
  }

  // LoginLog ผูกกับผู้ใช้แบบ SetNull — ประวัติการเข้าระบบเดิมจึงยังอยู่ครบ
  await prisma.session.deleteMany();
  const { count } = await prisma.user.deleteMany();

  console.log(`ลบบัญชีแล้ว ${count} บัญชี: ${users.map((u) => u.username).join(", ")}`);
  console.log("เปิดเว็บใหม่อีกครั้ง ระบบจะให้ตั้งบัญชีผู้ดูแลคนแรกเอง");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
