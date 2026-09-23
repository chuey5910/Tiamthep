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

import { SCOPE_SHEETS, getAccessToken } from "./google-auth";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

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

async function sheetsFetch(keyFile: string, url: string, init?: RequestInit): Promise<unknown> {
  const token = await getAccessToken(keyFile, SCOPE_SHEETS);
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
