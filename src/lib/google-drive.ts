/**
 * อัปไฟล์สำรองขึ้น Google Drive
 *
 * ทำไมต้องมี: ไฟล์สำรองที่อยู่ในเครื่องเดียวกับฐานข้อมูล ช่วยอะไรไม่ได้เลย
 * ตอนดิสก์พัง ไฟไหม้ หรือ NAS ถูกขโมย — ต้องมีสำเนาอยู่นอกบ้านด้วย
 *
 * ใช้ service account ตัวเดียวกับชีตสั่งงาน แต่คนละ scope
 * ⚠ service account ไม่มีพื้นที่ Drive ของตัวเอง — ต้องให้คนจริงแชร์โฟลเดอร์
 *   ให้อีเมลของ service account (สิทธิ์ Editor) ก่อน แล้วเอา id ของโฟลเดอร์มาใส่ .env
 */

import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { SCOPE_DRIVE, getAccessToken } from "./google-auth";

const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_API = "https://www.googleapis.com/drive/v3/files";
/** รองรับทั้ง My Drive ที่แชร์มา และ Shared Drive ของทีม */
const SHARED = "supportsAllDrives=true&includeItemsFromAllDrives=true";

export type DriveFile = { id: string; name: string; createdTime: string; size?: string };

export function driveConfig(): { keyFile: string; folderId: string } | { error: string } {
  const keyFile = (process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? "").trim();
  const folderId = (process.env.BACKUP_DRIVE_FOLDER_ID ?? "").trim();
  if (!keyFile) return { error: "ยังไม่ได้ตั้ง GOOGLE_SERVICE_ACCOUNT_FILE ใน .env" };
  if (!folderId) return { error: "ยังไม่ได้ตั้ง BACKUP_DRIVE_FOLDER_ID ใน .env" };
  return { keyFile, folderId };
}

/**
 * อัปไฟล์ขึ้นโฟลเดอร์ที่กำหนด — ใช้ resumable upload
 * (ไม่ใช้ multipart เพราะจำกัดที่ 5 MB ไฟล์สำรองโตเกินนั้นเมื่อไหร่จะพังเงียบๆ)
 */
export async function uploadToDrive(keyFile: string, folderId: string, filePath: string): Promise<DriveFile> {
  const token = await getAccessToken(keyFile, SCOPE_DRIVE);
  const name = basename(filePath);
  const size = statSync(filePath).size;

  // ขั้นที่ 1 — จองที่ แล้วรับ URL สำหรับส่งเนื้อไฟล์
  const startRes = await fetch(`${UPLOAD_API}?uploadType=resumable&${SHARED}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/gzip",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  if (!startRes.ok) {
    throw new Error(`เริ่มอัปโหลดไม่สำเร็จ (${startRes.status}): ${(await startRes.text()).slice(0, 300)}`);
  }
  const uploadUrl = startRes.headers.get("location");
  if (!uploadUrl) throw new Error("Google ไม่ได้ส่ง URL สำหรับอัปโหลดกลับมา");

  // ขั้นที่ 2 — ส่งเนื้อไฟล์
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/gzip", "Content-Length": String(size) },
    body: Readable.toWeb(createReadStream(filePath)) as ReadableStream,
    // @ts-expect-error — undici ต้องการ duplex เมื่อ body เป็น stream
    duplex: "half",
  });
  if (!putRes.ok) {
    throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (${putRes.status}): ${(await putRes.text()).slice(0, 300)}`);
  }
  const file = (await putRes.json()) as DriveFile;
  return { ...file, size: String(size) };
}

/** ไฟล์สำรองทั้งหมดในโฟลเดอร์ เรียงใหม่ไปเก่า */
export async function listBackups(keyFile: string, folderId: string): Promise<DriveFile[]> {
  const token = await getAccessToken(keyFile, SCOPE_DRIVE);
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,createdTime,size)",
    orderBy: "createdTime desc",
    pageSize: "200",
  });
  const res = await fetch(`${FILES_API}?${params}&${SHARED}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`อ่านรายการไฟล์ใน Drive ไม่สำเร็จ (${res.status})`);
  return ((await res.json()) as { files?: DriveFile[] }).files ?? [];
}

/**
 * ลบไฟล์สำรองใน Drive ที่เก่ากว่าที่กำหนด — คืนจำนวนที่ลบ
 * ลบเฉพาะไฟล์ชื่อขึ้นต้น tiamthep- เท่านั้น จะได้ไม่ไปแตะไฟล์อื่นที่คนเอามาวางในโฟลเดอร์
 */
export async function pruneDrive(keyFile: string, folderId: string, keepDays: number): Promise<number> {
  const token = await getAccessToken(keyFile, SCOPE_DRIVE);
  const cutoff = Date.now() - keepDays * 86400_000;
  const files = await listBackups(keyFile, folderId);

  let removed = 0;
  for (const f of files) {
    if (!f.name.startsWith("tiamthep-")) continue;
    if (new Date(f.createdTime).getTime() >= cutoff) continue;
    const res = await fetch(`${FILES_API}/${f.id}?${SHARED}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok || res.status === 404) removed++;
  }
  return removed;
}
