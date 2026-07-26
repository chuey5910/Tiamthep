/**
 * สำรองฐานข้อมูลด้วยมือ — เรียกใช้: npm run db:backup
 *
 * ปกติ container ชื่อ tiamthep-backup สำรองให้อัตโนมัติทุกวันตี 2 อยู่แล้ว
 * สคริปต์นี้ไว้ใช้ตอนจะทำอะไรเสี่ยงๆ เช่น ก่อนอัปเดตระบบหรือก่อนแก้ข้อมูลจำนวนมาก
 *
 * กู้คืน: gunzip -c backup/<ไฟล์>.sql.gz | psql "<DATABASE_URL ที่ตัด ?schema= ออกแล้ว>"
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./load-env";
import { pgUrlForCli } from "./pg-url";

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ไม่พบ DATABASE_URL — ตรวจไฟล์ .env");
  process.exit(1);
}

const dir = join(process.cwd(), "backup");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const file = join(dir, `tiamthep-manual-${stamp}.sql.gz`);

console.log("กำลังสำรองข้อมูล…");

// ไม่ใช้ pipe เข้า gzip โดยตรง เพราะ shell บางตัว (dash, busybox) ไม่มี pipefail
// ถ้า pg_dump พังแต่ gzip สำเร็จ จะได้ไฟล์เปล่าที่ดูเหมือนสำรองสำเร็จ
// แล้วมารู้ตัวตอนกู้คืนไม่ได้ — จึงเขียนไฟล์ก่อน เช็ค exit code แล้วค่อยบีบอัด
const plain = file.replace(/\.gz$/, "");
const env = { ...process.env, PG_CLI_URL: pgUrlForCli(url) };

const dump = spawnSync("pg_dump", ["--clean", "--if-exists", "--file", plain, env.PG_CLI_URL!], {
  stdio: ["ignore", "inherit", "inherit"],
  env,
});

let failed = dump.status !== 0 || !existsSync(plain) || statSync(plain).size < 1000;

if (!failed) {
  const gz = spawnSync("gzip", ["-f", plain], { stdio: ["ignore", "inherit", "inherit"] });
  failed = gz.status !== 0 || !existsSync(file);
}

if (existsSync(plain)) unlinkSync(plain);

if (failed) {
  if (existsSync(file)) unlinkSync(file);
  console.error(
    "\nสำรองข้อมูลไม่สำเร็จ — ไม่ได้สร้างไฟล์ทิ้งไว้",
    "\n",
    "\nถ้าขึ้นว่าไม่พบคำสั่ง pg_dump ให้ติดตั้ง postgresql-client ก่อน:",
    "\n  sudo apt install postgresql-client",
    "\n",
    "\nหรือสำรองผ่าน docker แทน (ไม่ต้องติดตั้งอะไรเพิ่ม):",
    "\n  docker exec tiamthep-db pg_dump --clean --if-exists -U tiamthep tiamthep | gzip > backup/manual.sql.gz",
  );
  process.exit(1);
}

const sizeMb = (statSync(file).size / 1024 / 1024).toFixed(2);
console.log(`สำรองข้อมูลเรียบร้อย: ${file} (${sizeMb} MB)`);
console.log(`กู้คืนด้วย: gunzip -c "${file}" | psql "${pgUrlForCli(url)}"`);
