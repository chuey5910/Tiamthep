/**
 * ใบสั่งงานร้านค้า (PO) — ซ่อมบำรุง/อะไหล่ สั่งผ่านไลน์บอท
 *
 * ไลน์บอท (line-bot/Code.gs) เขียนแท็บ «ใบสั่งงานร้าน» ในชีต → เว็บดึงมาเก็บ (ShopOrder)
 * แอดมินตรวจแล้วกดลงบัญชี: รายการของรถ → ค่าใช้จ่ายรายคัน · รายการเข้าคลัง → รับเข้าคลัง
 *
 * หลักความถูกต้อง
 *  - ข้อมูลฝั่งไลน์ (สถานะ ร้านตอบ ราคาที่ร้านแจ้ง) ยึดชีตเสมอ ดึงซ้ำกี่รอบก็ทับด้วยของจริง
 *  - ข้อมูลลงบัญชีเป็นของเว็บ ดึงชีตไม่ทับ · รายการที่ลงแล้วมี expenseId/stockInId ลงซ้ำไม่ได้
 *  - เงินทุกตัวผ่าน calc.ts (poLineAmounts)
 */

import { prisma } from "./prisma";
import { parseDate } from "./date";
import { poLineAmounts, round2 } from "./calc";
import { batchWriteValues, readValues, sheetConfig } from "./google-sheets";

// ── โครงแท็บ — ต้องตรงกับ PC / PO_HEADER ใน line-bot/Code.gs ──
export const PO_TAB = "ใบสั่งงานร้าน";
export const SHOPS_TAB = "ร้านค้า";
const LAST_COL = "S";
const C = {
  id: 0, seq: 1, at: 2, staff: 3, staffName: 4, shop: 5, shopName: 6, target: 7,
  item: 8, qty: 9, unit: 10, status: 11, answer: 12, price: 13, answeredAt: 14, pricedAt: 15,
  bill: 16, result: 17, raw: 18,
} as const;
const STATUS_COL = "L";
const RESULT_COL = "R";

export const POS = {
  WAIT: "รอร้านตอบ",
  ACCEPTED: "ร้านรับแล้ว",
  NONE: "ร้านไม่มีของ",
  PRICED: "แจ้งราคาแล้ว",
  POSTED: "ลงบัญชีแล้ว",
  CANCELLED: "ยกเลิก",
} as const;
export const ANS = { OK: "ทำได้", NO: "ไม่มีของ" } as const;
export const PO_STOCK = "คลัง";

/** "13/10/2026 14:05" (เวลาไทย) → Date · ปี พ.ศ. แปลงให้ · อ่านไม่ได้ = null */
export function parseSheetDateTime(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  let y = +m[3];
  if (y > 2400) y -= 543;
  const d = new Date(Date.UTC(y, +m[2] - 1, +m[1], +(m[4] ?? 0) - 7, +(m[5] ?? 0)));
  return isNaN(d.getTime()) ? null : d;
}

/** วันที่ (เที่ยงคืน UTC แบบที่ตารางอื่นใช้) ของเวลาไทย */
export function thaiDay(d: Date): Date {
  const b = new Date(d.getTime() + 7 * 3600e3);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
}

function num(s: string | undefined): number | null {
  const t = (s ?? "").replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type SyncResult = { ok: true; orders: number; changed: number } | { ok: false; error: string };

const SYNC_KEY = "shopOrders.syncedAt";

/** ดึงชีต ถ้ารอบล่าสุดเก่ากว่า maxAgeMs — เปิดหน้าแล้วข้อมูลสดเอง ไม่ต้องกดปุ่ม */
export async function syncShopOrdersIfStale(maxAgeMs = 20_000): Promise<SyncResult | null> {
  const last = await prisma.setting.findUnique({ where: { key: SYNC_KEY } });
  if (last && Date.now() - Number(last.value) < maxAgeMs) return null;
  return syncShopOrders();
}

/** ดึงแท็บ «ใบสั่งงานร้าน» ทั้งแท็บเข้าเว็บ — ทำซ้ำได้เสมอ ไม่เกิดข้อมูลซ้ำ */
export async function syncShopOrders(): Promise<SyncResult> {
  const cfg = sheetConfig();
  if ("error" in cfg) return { ok: false, error: cfg.error };
  let values: string[][];
  try {
    values = await readValues(cfg.keyFile, cfg.sheetId, `${PO_TAB}!A2:${LAST_COL}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unable to parse range")) {
      return { ok: false, error: `ชีตยังไม่มีแท็บ «${PO_TAB}» — เปิดชีตสั่งงาน กดเมนู 🚚 ไลน์บอท › ④ ตั้งค่าใบสั่งงานร้าน` };
    }
    return { ok: false, error: `ดึงชีตไม่สำเร็จ: ${msg.slice(0, 200)}` };
  }
  const res = await ingestPoRows(values);
  await prisma.setting.upsert({ where: { key: SYNC_KEY }, update: { value: String(Date.now()) }, create: { key: SYNC_KEY, value: String(Date.now()) } });
  return { ok: true, ...res };
}

/** แถวจากแท็บ «ใบสั่งงานร้าน» (ไม่รวมหัวตาราง) → ฐานข้อมูล · แยกออกมาให้ทดสอบกับแถวจริงได้โดยไม่ต้องต่อชีต */
export async function ingestPoRows(values: string[][]): Promise<{ orders: number; changed: number }> {
  type Row = { cells: string[] };
  const byId = new Map<string, Row[]>();
  for (const cells of values) {
    const id = (cells[C.id] ?? "").trim().toUpperCase();
    if (!id) continue;
    byId.set(id, [...(byId.get(id) ?? []), { cells }]);
  }

  const existing = await prisma.shopOrder.findMany({ include: { items: true } });
  const exById = new Map(existing.map((o) => [o.id, o]));
  let changed = 0;

  for (const [id, rows] of byId) {
    const h = rows[0].cells;
    const v = (i: number) => (h[i] ?? "").trim();
    const orderedAt = parseSheetDateTime(v(C.at)) ?? parseDate(v(C.at));
    if (!orderedAt) continue; // แถวที่คนไปแก้จนวันที่พัง — ไม่เดา
    const answered = rows.map((r) => parseSheetDateTime((r.cells[C.answeredAt] ?? "").trim())).filter((d): d is Date => !!d);
    const data = {
      orderedAt,
      staffCode: v(C.staff).toUpperCase(),
      staffName: v(C.staffName),
      shopCode: v(C.shop).toUpperCase(),
      shopName: v(C.shopName),
      target: v(C.target),
      status: v(C.status),
      respondedAt: answered.length ? new Date(Math.max(...answered.map((d) => d.getTime()))) : null,
      pricedAt: parseSheetDateTime(v(C.pricedAt)),
      billUrls: v(C.bill) || null,
      rawText: v(C.raw) || null,
    };
    const ex = exById.get(id);
    const items = rows.map((r, i) => ({
      seq: num(r.cells[C.seq]) ?? i + 1,
      description: (r.cells[C.item] ?? "").trim(),
      qty: num(r.cells[C.qty]) ?? 1,
      unit: (r.cells[C.unit] ?? "").trim() || null,
      answer: (r.cells[C.answer] ?? "").trim() || null,
      shopPrice: num(r.cells[C.price]),
    }));

    const same =
      ex &&
      (Object.keys(data) as (keyof typeof data)[]).every((k) => {
        const a = ex[k];
        const b = data[k];
        return a instanceof Date || b instanceof Date ? (a as Date | null)?.getTime() === (b as Date | null)?.getTime() : a === b;
      }) &&
      ex.items.length === items.length &&
      items.every((it) => {
        const e = ex.items.find((x) => x.seq === it.seq);
        return e && e.description === it.description && e.qty === it.qty && e.unit === it.unit && e.answer === it.answer && e.shopPrice === it.shopPrice;
      });
    if (same) continue;

    changed++;
    await prisma.$transaction(async (tx) => {
      await tx.shopOrder.upsert({ where: { id }, update: { ...data, syncedAt: new Date() }, create: { id, ...data } });
      for (const it of items) {
        await tx.shopOrderItem.upsert({
          where: { orderId_seq: { orderId: id, seq: it.seq } },
          update: it,
          create: { orderId: id, ...it },
        });
      }
    });
  }
  return { orders: byId.size, changed };
}

/** เขียนสถานะ/ผลลงบัญชีกลับลงทุกแถวของใบในชีต — หาแถวจากเลขใบตอนเขียน (กันชีตถูกแทรกแถว) */
export async function writeOrderToSheet(id: string, status: string | null, result: string): Promise<void> {
  const cfg = sheetConfig();
  if ("error" in cfg) throw new Error(cfg.error);
  const ids = await readValues(cfg.keyFile, cfg.sheetId, `${PO_TAB}!A2:A`);
  const writes: { range: string; values: string[][] }[] = [];
  ids.forEach((r, i) => {
    if ((r[0] ?? "").trim().toUpperCase() !== id) return;
    const row = i + 2;
    if (status) writes.push({ range: `${PO_TAB}!${STATUS_COL}${row}`, values: [[status]] });
    writes.push({ range: `${PO_TAB}!${RESULT_COL}${row}`, values: [[result]] });
  });
  if (!writes.length) throw new Error(`ไม่พบใบ ${id} ในชีตแล้ว`);
  await batchWriteValues(cfg.keyFile, cfg.sheetId, writes);
}

// ── การแสดงผล ──

export type OrderView = Awaited<ReturnType<typeof loadOrders>>[number];

export async function loadOrders(where: { shop?: string; from?: Date | null; to?: Date | null; status?: string }) {
  const orders = await prisma.shopOrder.findMany({
    where: {
      ...(where.shop ? { shopName: where.shop } : {}),
      ...(where.from || where.to
        ? { orderedAt: { ...(where.from ? { gte: new Date(where.from.getTime() - 7 * 3600e3) } : {}), ...(where.to ? { lt: new Date(where.to.getTime() + 17 * 3600e3) } : {}) } }
        : {}),
    },
    include: { items: { orderBy: { seq: "asc" } } },
    orderBy: { id: "desc" },
  });
  const views = orders.map((o) => ({ ...o, view: orderState(o) }));
  return where.status ? views.filter((o) => o.view.key === where.status) : views;
}

export type StateKey = "wait" | "doing" | "none" | "priced" | "posted" | "cancelled" | "unknown";

/** สถานะที่คนอ่านแล้วรู้เลย — ขึ้นต้นด้วยเครื่องหมายเดียวกันทุกแถว */
export function orderState(o: {
  status: string;
  postedAt: Date | null;
  items: { answer: string | null; shopPrice: number | null; expenseId: number | null; stockInId: number | null }[];
}): { key: StateKey; icon: string; label: string; tone: string; note?: string } {
  const ok = o.items.filter((i) => i.answer === ANS.OK);
  const posted = ok.filter((i) => i.expenseId != null || i.stockInId != null).length;
  const part = ok.length < o.items.length && ok.length > 0 ? `ทำได้ ${ok.length} จาก ${o.items.length} รายการ` : undefined;
  if (o.status === POS.CANCELLED) return { key: "cancelled", icon: "🚫", label: "ยกเลิก", tone: "text-slate-500" };
  if (o.status === POS.WAIT) return { key: "wait", icon: "⏳", label: "รอร้านตอบ", tone: "text-amber-700" };
  if (o.status === POS.NONE) return { key: "none", icon: "❌", label: "ร้านไม่มีของ — ปิดใบ", tone: "text-red-700" };
  if (o.status === POS.ACCEPTED) return { key: "doing", icon: "🔧", label: "ร้านรับแล้ว กำลังทำ", tone: "text-sky-700", note: part };
  if (o.status === POS.PRICED || o.status === POS.POSTED) {
    if (ok.length > 0 && posted === ok.length) return { key: "posted", icon: "📗", label: "ลงบัญชีแล้ว", tone: "text-emerald-800", note: part };
    return {
      key: "priced",
      icon: "✅",
      label: "เสร็จ แจ้งราคาแล้ว",
      tone: "text-emerald-700",
      note: [part, posted ? `ลงแล้ว ${posted} จาก ${ok.length}` : ""].filter(Boolean).join(" · ") || undefined,
    };
  }
  return { key: "unknown", icon: "⚠️", label: `สถานะในชีต «${o.status || "ว่าง"}» ไม่รู้จัก`, tone: "text-amber-700", note: "แก้คอลัมน์ L ในชีต" };
}

/** ราคารวมที่ร้านแจ้ง (เฉพาะรายการที่ทำได้) */
export function shopTotal(items: { answer: string | null; shopPrice: number | null }[]): number | null {
  const ok = items.filter((i) => i.answer === ANS.OK);
  if (!ok.length || ok.some((i) => i.shopPrice == null)) return null;
  return round2(ok.reduce((a, i) => a + (i.shopPrice ?? 0), 0));
}

export { poLineAmounts };
