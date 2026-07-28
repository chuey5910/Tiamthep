/**
 * ตัวเชื่อม Google Sheets API ด้วย Service Account
 *
 * ใช้กับระบบ «งานจากไลน์»: เว็บเป็นฝ่าย "ดึง" ข้อมูลจากชีตเอง (pull)
 * เครื่อง CHUEY-Server จึงไม่ต้องเปิดพอร์ตให้ใครยิงเข้ามาจากอินเทอร์เน็ต
 *
 * เขียนด้วย node:crypto + fetch ล้วน ไม่พึ่งไลบรารีภายนอก
 * เพื่อให้ติดตั้งบนเครื่องจริงได้ง่ายและไม่มีปัญหาเวอร์ชันชนกัน
 *
 * ต้องตั้งใน .env:
 *   LINE_SHEET_ID              — id ของชีตสั่งงาน (ตัวอักษรยาวๆ ใน URL ของชีต)
 *   GOOGLE_SERVICE_ACCOUNT_FILE — ที่อยู่ไฟล์ key ของ service account (.json)
 */

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

type ServiceAccount = { client_email: string; private_key: string };

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// เก็บ token ไว้ใช้ซ้ำจนใกล้หมดอายุ — ลดจำนวนครั้งที่ขอ token ใหม่
let cachedToken: { token: string; expiresAt: number } | null = null;

export function sheetConfig(): { sheetId: string; keyFile: string } | { error: string } {
  const sheetId = (process.env.LINE_SHEET_ID ?? "").trim();
  const keyFile = (process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? "").trim();
  if (!sheetId || !keyFile) {
    return {
      error:
        "ยังไม่ได้ตั้งค่าเชื่อมชีตสั่งงาน — เพิ่ม LINE_SHEET_ID และ GOOGLE_SERVICE_ACCOUNT_FILE ใน .env (ดูวิธีใน line-bot/README.md)",
    };
  }
  return { sheetId, keyFile };
}

function loadServiceAccount(keyFile: string): ServiceAccount {
  const raw = JSON.parse(readFileSync(keyFile, "utf8")) as Partial<ServiceAccount>;
  if (!raw.client_email || !raw.private_key) {
    throw new Error("ไฟล์ service account ไม่ถูกต้อง — ต้องมี client_email และ private_key");
  }
  return raw as ServiceAccount;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** ขอ access token จาก Google ด้วย JWT ที่เซ็นด้วย private key ของ service account */
async function getAccessToken(keyFile: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const sa = loadServiceAccount(keyFile);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`ขอ token จาก Google ไม่สำเร็จ (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function sheetsFetch(keyFile: string, url: string, init?: RequestInit): Promise<unknown> {
  const token = await getAccessToken(keyFile);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Google Sheets ตอบ ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/** อ่านค่าช่วงเซลล์ เช่น "งาน!A2:R" — คืน array ของแถว (ค่าทุกช่องเป็น string) */
export async function readValues(
  keyFile: string,
  sheetId: string,
  range: string,
): Promise<string[][]> {
  const url = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const data = (await sheetsFetch(keyFile, url)) as { values?: unknown[][] };
  return (data.values ?? []).map((row) => row.map((c) => (c == null ? "" : String(c))));
}

/** เขียนทับค่าในช่วงเซลล์ */
export async function writeValues(
  keyFile: string,
  sheetId: string,
  range: string,
  values: (string | number)[][],
): Promise<void> {
  const url = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  await sheetsFetch(keyFile, url, { method: "PUT", body: JSON.stringify({ range, values }) });
}

/** เขียนหลายช่วงในคำขอเดียว — ใช้ตอนเขียนผลนำเข้ากลับลงชีต ลดโอกาสเขียนค้างครึ่งเดียว */
export async function batchWriteValues(
  keyFile: string,
  sheetId: string,
  updates: { range: string; values: (string | number)[][] }[],
): Promise<void> {
  if (updates.length === 0) return;
  const url = `${SHEETS_API}/${sheetId}/values:batchUpdate`;
  await sheetsFetch(keyFile, url, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updates }),
  });
}

/** ล้างค่าช่วงเซลล์ (ใช้ก่อนเขียนข้อมูลหลักชุดใหม่ทั้งชุด) */
export async function clearValues(keyFile: string, sheetId: string, range: string): Promise<void> {
  const url = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}:clear`;
  await sheetsFetch(keyFile, url, { method: "POST", body: "{}" });
}
