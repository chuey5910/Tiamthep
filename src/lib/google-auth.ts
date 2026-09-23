/**
 * ขอ access token จาก Google ด้วย Service Account (JWT bearer)
 *
 * แยกออกมาเป็นไฟล์กลาง เพราะตอนนี้มีสองงานที่ต้องคุยกับ Google ด้วยกุญแจเดียวกัน
 *   • ชีตสั่งงาน  → scope spreadsheets
 *   • สำรองข้อมูลขึ้น Drive → scope drive
 * ใช้ node:crypto + fetch ล้วน ไม่พึ่งไลบรารีภายนอก จะได้ไม่มีปัญหาเวอร์ชันชนกันบนเครื่องจริง
 */

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export const SCOPE_SHEETS = "https://www.googleapis.com/auth/spreadsheets";
export const SCOPE_DRIVE = "https://www.googleapis.com/auth/drive";

type ServiceAccount = { client_email: string; private_key: string };

/** เก็บ token แยกตาม scope — คนละ scope คนละ token */
const cache = new Map<string, { token: string; expiresAt: number }>();

export function loadServiceAccount(keyFile: string): ServiceAccount {
  const raw = JSON.parse(readFileSync(keyFile, "utf8")) as Partial<ServiceAccount>;
  if (!raw.client_email || !raw.private_key) {
    throw new Error("ไฟล์ service account ไม่ถูกต้อง — ต้องมี client_email และ private_key");
  }
  return raw as ServiceAccount;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** ขอ token ของ scope ที่ต้องการ — ใช้ token เดิมซ้ำจนใกล้หมดอายุ */
export async function getAccessToken(keyFile: string, scope: string): Promise<string> {
  const key = `${keyFile}|${scope}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const sa = loadServiceAccount(keyFile);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) {
    throw new Error(`ขอ token จาก Google ไม่สำเร็จ (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(key, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
