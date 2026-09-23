/**
 * สำรองฐานข้อมูล 1 รอบ — ดัมป์ → บีบอัด → ลบของเก่า → อัปขึ้น Google Drive → แจ้งไลน์
 *
 * เรียกใช้:
 *   npx tsx scripts/backup-run.ts                 สำรองเดี๋ยวนี้ (แจ้งไลน์เฉพาะตอนพัง)
 *   npx tsx scripts/backup-run.ts --notify-success แจ้งไลน์ทั้งสำเร็จและไม่สำเร็จ (ตัวตั้งเวลาใช้ตัวนี้)
 *
 * หลักการ: ทุกขั้นที่ "ไม่ทำก็ไม่เป็นไร" (อัป Drive / แจ้งไลน์) ต้องไม่ทำให้การสำรองพัง
 * แต่ถ้าขั้นไหนไม่สำเร็จ ต้องมีคนรู้เสมอ — ไม่มีคำว่าเงียบ
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { driveConfig, pruneDrive, uploadToDrive } from "../src/lib/google-drive";
import { notifyAdmins } from "../src/lib/line-notify";
import { loadEnv } from "./load-env";
import { pgUrlForCli } from "./pg-url";

loadEnv();

const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 30) || 30;
const DIR = process.env.BACKUP_DIR?.trim() || join(process.cwd(), "backup");

export type BackupOutcome = {
  ok: boolean;
  file?: string;
  bytes?: number;
  localPruned: number;
  drive: string;
  error?: string;
};

/** ขนาดไฟล์แบบอ่านง่าย */
function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** เวลาไทยแบบอ่านง่าย — กล่องตั้ง TZ=Asia/Bangkok ไว้แล้ว */
function stampNow(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/** ลบไฟล์สำรองในเครื่องที่เก่ากว่าที่กำหนด — คืนจำนวนที่ลบ */
function pruneLocal(): number {
  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  let removed = 0;
  for (const name of readdirSync(DIR)) {
    if (!name.startsWith("tiamthep-") || !name.endsWith(".sql.gz")) continue;
    const path = join(DIR, name);
    if (statSync(path).mtimeMs >= cutoff) continue;
    unlinkSync(path);
    removed++;
  }
  return removed;
}

export async function runBackup(): Promise<BackupOutcome> {
  const url = process.env.DATABASE_URL;
  if (!url) return { ok: false, localPruned: 0, drive: "ข้าม", error: "ไม่พบ DATABASE_URL ใน .env" };

  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

  const plain = join(DIR, `tiamthep-${stampNow()}.sql`);
  const gz = `${plain}.gz`;

  // ไม่ pipe เข้า gzip ตรงๆ — ถ้า pg_dump พังแต่ gzip สำเร็จ จะได้ไฟล์เปล่าที่ดูเหมือนสำเร็จ
  // แล้วมารู้ตัวตอนกู้คืนไม่ได้ จึงเขียนไฟล์ → เช็ค exit code + ขนาด → ค่อยบีบอัด
  const dump = spawnSync("pg_dump", ["--clean", "--if-exists", "--file", plain, pgUrlForCli(url)], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (dump.status !== 0 || !existsSync(plain) || statSync(plain).size === 0) {
    if (existsSync(plain)) unlinkSync(plain);
    return {
      ok: false,
      localPruned: 0,
      drive: "ข้าม",
      error: `pg_dump ไม่สำเร็จ (exit ${dump.status ?? "?"}) — ไม่ได้เก็บไฟล์เปล่าไว้`,
    };
  }

  const gzip = spawnSync("gzip", ["-f", plain], { stdio: ["ignore", "inherit", "inherit"] });
  if (gzip.status !== 0 || !existsSync(gz)) {
    if (existsSync(plain)) unlinkSync(plain);
    return { ok: false, localPruned: 0, drive: "ข้าม", error: "บีบอัดไฟล์ไม่สำเร็จ" };
  }

  const bytes = statSync(gz).size;
  const localPruned = pruneLocal();

  // ── สำเนานอกบ้าน ── ล้มเหลวได้ แต่ห้ามเงียบ
  //
  // ค่าปริยายของที่นี่: ไม่ได้ตั้ง BACKUP_DRIVE_FOLDER_ID เพราะให้แอปของ NAS
  // ซิงก์โฟลเดอร์สำรองขึ้น Google Drive ด้วยบัญชีของเจ้าของเอง
  // (service account ไม่มีพื้นที่เก็บของตัวเอง จึงอัปเข้า My Drive ไม่ได้
  //  ต้องมี Google Workspace ถึงจะใช้ไดรฟ์ที่แชร์ได้ — เลยเลี่ยงมาทางนี้)
  let drive = "แอปของ NAS ซิงก์เอง — ระบบนี้ตรวจให้ไม่ได้ ดูที่หน้าแอปเป็นระยะ";
  const cfg = driveConfig();
  if ("error" in cfg) {
    // ตั้งค่าไว้ครึ่งๆ กลางๆ ต้องบอก ไม่ใช่ปล่อยผ่านเหมือนตั้งใจไม่ตั้ง
    const halfSet = (process.env.BACKUP_DRIVE_FOLDER_ID ?? "").trim() !== "";
    if (halfSet) drive = `❌ ตั้งค่าไว้ไม่ครบ — ${cfg.error}`;
  } else {
    try {
      await uploadToDrive(cfg.keyFile, cfg.folderId, gz);
      const dropped = await pruneDrive(cfg.keyFile, cfg.folderId, KEEP_DAYS);
      drive = dropped > 0 ? `อัปแล้ว (ลบของเก่าใน Drive ${dropped} ไฟล์)` : "อัปแล้ว";
    } catch (e) {
      drive = `❌ อัปขึ้น Drive ไม่สำเร็จ — ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`;
    }
  }

  return { ok: true, file: gz.split("/").pop(), bytes, localPruned, drive };
}

/** ข้อความที่ส่งเข้าไลน์ — อ่านจบในหน้าจอเดียว บอกว่าต้องทำอะไรต่อไหม */
export function backupMessage(r: BackupOutcome): string {
  const when = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  if (!r.ok) {
    return [
      "❌ สำรองข้อมูลไม่สำเร็จ",
      `เวลา: ${when}`,
      `สาเหตุ: ${r.error ?? "ไม่ทราบ"}`,
      "",
      "ให้ตรวจที่ NAS:",
      "sudo docker logs tiamthep-backup --tail 50",
    ].join("\n");
  }
  const driveBad = r.drive.startsWith("❌");
  return [
    driveBad ? "⚠️ สำรองข้อมูลแล้ว แต่ยังไม่มีสำเนานอกบ้าน" : "✅ สำรองข้อมูลเรียบร้อย",
    `เวลา: ${when}`,
    `ไฟล์: ${r.file}`,
    `ขนาด: ${human(r.bytes ?? 0)}`,
    `สำเนานอกบ้าน: ${r.drive}`,
    `เก็บย้อนหลัง: ${KEEP_DAYS} วัน${r.localPruned ? ` (ลบของเก่าในเครื่อง ${r.localPruned} ไฟล์)` : ""}`,
  ].join("\n");
}

/** รัน 1 รอบพร้อมแจ้งไลน์ — ใช้ทั้งจากตัวตั้งเวลาและจากคำสั่งมือ */
export async function backupAndNotify(notifySuccess: boolean): Promise<BackupOutcome> {
  const result = await runBackup();
  const message = backupMessage(result);
  console.log(message);

  const driveBad = result.drive.startsWith("❌");
  if (!result.ok || driveBad || notifySuccess) {
    const n = await notifyAdmins(message);
    if (n.skipped) console.log(`(ไม่ได้แจ้งไลน์ — ${n.skipped})`);
    else console.log(`แจ้งไลน์ผู้ดูแลแล้ว ${n.sent} คน${n.errors.length ? ` · ไม่สำเร็จ: ${n.errors.join(" · ")}` : ""}`);
  }
  return result;
}

// เรียกตรงจากบรรทัดคำสั่ง
if (process.argv[1]?.endsWith("backup-run.ts")) {
  const notifySuccess = process.argv.includes("--notify-success");
  backupAndNotify(notifySuccess).then((r) => process.exit(r.ok ? 0 : 1));
}
