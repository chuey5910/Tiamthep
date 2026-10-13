/**
 * เมนูร้าน (rich menu) ในไลน์บริษัท — แสดงเฉพาะไลน์ของร้านที่ลงทะเบียนแล้ว คนขับ/พนักงานไม่เห็น
 *
 * ติดตั้งจากเว็บครั้งเดียว (มีรูปเมนูอยู่ที่ line-bot/richmenu-shop.png) — กดซ้ำได้ เมนูเก่าถูกแทนที่
 * ไลน์บอทหาเมนูนี้จากชื่อ (SHOP_RICHMENU_NAME) แล้วผูกให้ร้านที่ลงทะเบียนทีหลังเอง
 * การสร้าง/ผูกเมนูไม่ใช่การส่งข้อความ จึงไม่กินโควตาข้อความของไลน์
 *
 * ข้อความของปุ่มต้องตรงกับ MENU_ORDERS / MENU_PRICE / MENU_CONTACT ใน line-bot/Code.gs
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readValues, sheetConfig } from "./google-sheets";
import { SHOPS_TAB } from "./shop-orders";

export const SHOP_RICHMENU_NAME = "tiamthep-shop";
export const SHOP_MENU = ["📋 ออเดอร์ของร้าน", "🧾 แจ้งราคา / ปิดงาน", "📞 ติดต่อบริษัท"] as const;

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";
const USER_ID = /^U[0-9a-f]{32}$/i;

function token(): string {
  const t = (process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "").trim();
  if (!t) throw new Error("ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน .env (ค่าเดียวกับใน Script Properties ของไลน์บอท)");
  return t;
}

async function line(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token()}`, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`LINE ตอบ ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function shopMenus(): Promise<string[]> {
  const data = (await line(`${API}/richmenu/list`)) as { richmenus?: { richMenuId: string; name: string }[] };
  return (data.richmenus ?? []).filter((m) => m.name === SHOP_RICHMENU_NAME).map((m) => m.richMenuId);
}

/** เมนูร้านติดตั้งแล้วหรือยัง — null = ตรวจไม่ได้ (เช่น ยังไม่ตั้ง token) พร้อมเหตุผล */
export async function shopMenuStatus(): Promise<{ installed: boolean } | { error: string }> {
  try {
    return { installed: (await shopMenus()).length > 0 };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** LINE userId ของร้านที่ลงทะเบียนแล้ว (แท็บ «ร้านค้า» คอลัมน์ C) */
async function registeredShops(): Promise<string[]> {
  const cfg = sheetConfig();
  if ("error" in cfg) throw new Error(cfg.error);
  const rows = await readValues(cfg.keyFile, cfg.sheetId, `${SHOPS_TAB}!C2:C`).catch(() => [] as string[][]);
  return [...new Set(rows.map((r) => (r[0] ?? "").trim()).filter((id) => USER_ID.test(id)))];
}

/** สร้างเมนูใหม่ → ใส่รูป → ผูกร้านที่ลงทะเบียนแล้ว → ลบเมนูเก่า */
export async function installShopMenu(): Promise<{ linked: number }> {
  const old = await shopMenus();
  const W = 2500;
  const H = 843;
  const col = Math.floor(W / 3);
  const created = (await line(`${API}/richmenu`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: { width: W, height: H },
      selected: true,
      name: SHOP_RICHMENU_NAME,
      chatBarText: "เมนูร้านค้า",
      areas: SHOP_MENU.map((text, i) => ({
        bounds: { x: i * col, y: 0, width: i === 2 ? W - 2 * col : col, height: H },
        action: { type: "message", text },
      })),
    }),
  })) as { richMenuId: string };
  const id = created.richMenuId;

  const image = await readFile(path.join(process.cwd(), "line-bot", "richmenu-shop.png"));
  await line(`${DATA_API}/richmenu/${id}/content`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array(image),
  });

  const users = await registeredShops();
  for (let i = 0; i < users.length; i += 500) {
    await line(`${API}/richmenu/bulk/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ richMenuId: id, userIds: users.slice(i, i + 500) }),
    });
  }
  for (const o of old) await line(`${API}/richmenu/${o}`, { method: "DELETE" }).catch(() => undefined);
  return { linked: users.length };
}
