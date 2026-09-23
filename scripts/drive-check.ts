/**
 * ตรวจการเชื่อม Google Drive ของระบบสำรองข้อมูล — ตอบให้ครบว่า "ติดตรงไหน"
 *
 * เรียกใช้บน NAS:
 *   sudo docker exec -t tiamthep-backup npx tsx scripts/drive-check.ts
 *
 * ไม่แตะไฟล์สำรองที่มีอยู่ กดกี่รอบก็ได้
 * ขั้นสุดท้ายอัปไฟล์ทดสอบเล็กๆ ขึ้นไปแล้วลบทิ้ง — เพราะ "อ่านได้" ไม่ได้แปลว่า "อัปได้"
 */

import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadServiceAccount, getAccessToken, SCOPE_DRIVE } from "../src/lib/google-auth";
import { cleanFolderId, listBackups, uploadToDrive } from "../src/lib/google-drive";
import { loadEnv } from "./load-env";

loadEnv();

const FILES_API = "https://www.googleapis.com/drive/v3/files";
const SHARED = "supportsAllDrives=true&includeItemsFromAllDrives=true";

async function main(): Promise<number> {
  const keyFile = (process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? "").trim();
  const rawFolder = (process.env.BACKUP_DRIVE_FOLDER_ID ?? "").trim();
  const folderId = cleanFolderId(rawFolder);

  console.log("── ตรวจการเชื่อม Google Drive ──\n");

  // 1) ไฟล์กุญแจ
  if (!keyFile) {
    console.log("❌ ยังไม่ได้ตั้ง GOOGLE_SERVICE_ACCOUNT_FILE ใน secrets/.env");
    return 1;
  }
  if (!existsSync(keyFile)) {
    console.log(`❌ ไม่พบไฟล์กุญแจที่ ${keyFile}`);
    console.log("   เอาไฟล์ .json ไปวางที่ secrets/google-service-account.json บน NAS");
    return 1;
  }
  let email = "";
  try {
    email = loadServiceAccount(keyFile).client_email;
  } catch (e) {
    console.log(`❌ ไฟล์กุญแจใช้ไม่ได้ — ${e instanceof Error ? e.message : "อ่านไม่ออก"}`);
    return 1;
  }
  console.log(`✅ ไฟล์กุญแจ: ${keyFile}`);
  console.log(`   อีเมลของ service account: ${email}`);
  console.log("   ← โฟลเดอร์ใน Drive ต้องแชร์ให้อีเมลนี้ สิทธิ์ ผู้แก้ไข (Editor)\n");

  // 2) รหัสโฟลเดอร์
  if (!folderId) {
    console.log("❌ ยังไม่ได้ตั้ง BACKUP_DRIVE_FOLDER_ID ใน secrets/.env");
    return 1;
  }
  console.log(`✅ รหัสโฟลเดอร์ที่ใช้: ${folderId}`);
  if (folderId !== rawFolder) console.log(`   (ตัดจากค่าที่ตั้งไว้: ${rawFolder})`);
  console.log("");

  // 3) ขอ token
  let token = "";
  try {
    token = await getAccessToken(keyFile, SCOPE_DRIVE);
    console.log("✅ ขอสิทธิ์จาก Google ผ่าน\n");
  } catch (e) {
    console.log(`❌ ขอสิทธิ์จาก Google ไม่ผ่าน — ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`);
    console.log("   เช็กว่านาฬิกาของ NAS ตรง และไฟล์กุญแจยังไม่ถูกยกเลิกในหน้า Google Cloud");
    return 1;
  }

  // 4) เปิดโฟลเดอร์
  const res = await fetch(`${FILES_API}/${folderId}?fields=id,name,mimeType,driveId&${SHARED}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();

  if (res.status === 404) {
    console.log("❌ เปิดโฟลเดอร์ไม่ได้ (404 ไม่พบ)");
    console.log("   เป็นได้ 2 อย่าง แก้ทีละข้อ:");
    console.log("   1. รหัสโฟลเดอร์ผิด — เปิดโฟลเดอร์ใน Drive แล้วดูที่ช่อง URL");
    console.log("      https://drive.google.com/drive/folders/【เอาส่วนนี้】");
    console.log(`   2. ยังไม่ได้แชร์โฟลเดอร์ให้ ${email} (สิทธิ์ ผู้แก้ไข)`);
    console.log("      Google ตอบ 404 เหมือนกันทั้งกรณีไม่มีโฟลเดอร์และกรณีไม่มีสิทธิ์");
    return 1;
  }
  if (res.status === 403) {
    console.log("❌ เปิดโฟลเดอร์ไม่ได้ (403 ไม่มีสิทธิ์)");
    if (/has not been used in project|SERVICE_DISABLED|accessNotConfigured/.test(body)) {
      const project = body.match(/project (\d+)/)?.[1];
      console.log("   ยังไม่ได้เปิดใช้ Google Drive API ในโปรเจกต์ของ service account");
      if (project) {
        console.log(`   เปิดที่ https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${project}`);
      }
    } else {
      console.log(`   แชร์โฟลเดอร์ให้ ${email} สิทธิ์ ผู้แก้ไข (Editor) ก่อน`);
    }
    return 1;
  }
  if (!res.ok) {
    console.log(`❌ เปิดโฟลเดอร์ไม่ได้ (${res.status}): ${body.slice(0, 200)}`);
    return 1;
  }

  const folder = JSON.parse(body) as { name: string; mimeType: string; driveId?: string };
  if (folder.mimeType !== "application/vnd.google-apps.folder") {
    console.log(`❌ รหัสนี้ไม่ใช่โฟลเดอร์ แต่เป็น ${folder.mimeType}`);
    console.log("   ต้องใช้รหัสของโฟลเดอร์ ไม่ใช่ของไฟล์");
    return 1;
  }
  console.log(`✅ เปิดโฟลเดอร์ได้: "${folder.name}"${folder.driveId ? " (อยู่ใน Shared Drive)" : ""}\n`);

  // 5) อ่านรายการไฟล์สำรองที่มีอยู่
  try {
    const files = await listBackups(keyFile, folderId);
    const backups = files.filter((f) => f.name.startsWith("tiamthep-"));
    console.log(`✅ อ่านรายการไฟล์ได้ — มีไฟล์สำรองใน Drive ${backups.length} ไฟล์`);
    for (const f of backups.slice(0, 5)) {
      const when = new Date(f.createdTime).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
      console.log(`   · ${f.name} — ${when}`);
    }
    if (backups.length === 0) console.log("   (ยังไม่เคยอัปสำเร็จสักไฟล์ — สั่งสำรองอีกรอบได้เลย)");
  } catch (e) {
    console.log(`⚠️ เปิดโฟลเดอร์ได้ แต่อ่านรายการไฟล์ไม่ได้ — ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`);
    return 1;
  }

  // 6) ทดสอบ "เขียน" จริง — อ่านได้ไม่ได้แปลว่าอัปได้
  //    (แชร์เป็นผู้อ่าน หรือโฟลเดอร์อยู่ใน My Drive ซึ่ง service account ไม่มีพื้นที่ จะพังตรงนี้)
  console.log("\n▶ ทดสอบอัปไฟล์จริง (ไฟล์ทดสอบเล็กๆ แล้วลบทิ้ง)...");
  const testPath = join(tmpdir(), `tiamthep-drive-test-${Date.now()}.txt`);
  writeFileSync(testPath, "ทดสอบการอัปโหลดของระบบสำรองข้อมูลเทียมเทพ\n");
  try {
    const up = await uploadToDrive(keyFile, folderId, testPath);
    console.log("✅ อัปไฟล์ขึ้น Drive ได้จริง");
    const del = await fetch(`${FILES_API}/${up.id}?${SHARED}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(del.ok || del.status === 404 ? "✅ ลบไฟล์ทดสอบเรียบร้อย" : `⚠️ ลบไฟล์ทดสอบไม่สำเร็จ — ไปลบ ${up.name} ใน Drive เองด้วย`);
  } catch (e) {
    console.log(`❌ อัปไฟล์ไม่สำเร็จ — ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`);
    return 1;
  } finally {
    if (existsSync(testPath)) unlinkSync(testPath);
  }

  console.log("\n✅ พร้อมใช้งาน — สั่งสำรองจริงได้ด้วย");
  console.log("   sudo docker exec -t tiamthep-backup npx tsx scripts/backup-run.ts");
  return 0;
}

main().then((code) => process.exit(code));
