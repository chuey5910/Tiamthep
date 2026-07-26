/**
 * อ่านค่าจากไฟล์ .env เข้า process.env
 *
 * Prisma อ่าน .env ให้เองอยู่แล้ว แต่สคริปต์ที่เรียกคำสั่งภายนอก (เช่น pg_dump)
 * ต้องมีค่าใน process.env ด้วย จึงต้องอ่านเองอีกรอบ
 * ค่าที่ตั้งมาจาก shell อยู่แล้วจะไม่ถูกทับ
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadEnv(file = ".env"): void {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    if (key in process.env) continue; // ค่าจาก shell ชนะเสมอ

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
