/**
 * นับจำนวนแถวของทุกตาราง — ใช้ตรวจว่าย้ายข้อมูลข้ามเครื่องแล้วครบจริง
 *
 * ที่เครื่องเดิม (ก่อนย้าย):   npm run rows > before.txt
 * ที่เครื่องใหม่ (หลังกู้ข้อมูล): npm run rows > after.txt
 * แล้วเทียบสองไฟล์ — ต้องเหมือนกันทุกบรรทัด
 *
 * เทียบเร็วๆ บนเครื่องเดียวกัน:  diff before.txt after.txt && echo "ครบเหมือนกัน"
 */
import { loadEnv } from "./load-env";
import { Prisma, PrismaClient } from "@prisma/client";

loadEnv();
const prisma = new PrismaClient();

async function main() {
  // ไล่จากโครงสร้างจริงของ schema — เพิ่มตารางใหม่แล้วไม่ต้องมาแก้สคริปต์นี้
  const models = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();

  let total = 0;
  const lines: string[] = [];

  for (const name of models) {
    const key = name.charAt(0).toLowerCase() + name.slice(1);
    const model = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[key];
    if (!model?.count) continue;
    const n = await model.count();
    total += n;
    lines.push(`${name.padEnd(18)} ${String(n).padStart(8)}`);
  }

  console.log(lines.join("\n"));
  console.log("-".repeat(27));
  console.log(`${"รวมทุกตาราง".padEnd(18)} ${String(total).padStart(8)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
