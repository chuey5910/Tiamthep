"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { poLineAmounts, round2 } from "@/lib/calc";
import { ANS, POS, PO_STOCK, syncShopOrders, thaiDay, writeOrderToSheet } from "@/lib/shop-orders";

type Result = { ok: true; message: string; warning?: string } | { ok: false; error: string };

async function admin(): Promise<{ name: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "ยังไม่ได้เข้าระบบ" };
  if (!isAdmin(user)) return { error: "เฉพาะผู้ดูแลระบบเท่านั้นที่ลงบัญชี/ยกเลิกใบสั่งงานได้" };
  return { name: user.name || user.username };
}

/** ดึงใบสั่งงานล่าสุดจากชีต */
export async function refreshOrders(): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าระบบ" };
  const res = await syncShopOrders();
  if (!res.ok) return res;
  revalidatePath("/stock/orders");
  return { ok: true, message: `✅ ดึงล่าสุดแล้ว — ${res.orders} ใบ · มีเปลี่ยนแปลง ${res.changed} ใบ` };
}

/** แอดมินยกเลิกใบ — เขียนลงชีต ร้านจะไม่เห็นใบนี้ในเมนูอีก · ใบที่ลงบัญชีแล้วยกเลิกไม่ได้ */
export async function cancelOrder(id: string): Promise<Result> {
  const who = await admin();
  if ("error" in who) return { ok: false, error: who.error };
  await syncShopOrders();
  const o = await prisma.shopOrder.findUnique({ where: { id }, include: { items: true } });
  if (!o) return { ok: false, error: `ไม่พบใบ ${id}` };
  if (o.items.some((i) => i.expenseId != null || i.stockInId != null)) {
    return { ok: false, error: `${id} ลงบัญชีไปแล้ว ยกเลิกไม่ได้ — ต้องลบรายการในหน้า ค่าใช้จ่าย / คลังอะไหล่ ก่อน` };
  }
  if (o.status === POS.CANCELLED) return { ok: true, message: `${id} ยกเลิกอยู่แล้ว` };
  try {
    await writeOrderToSheet(id, POS.CANCELLED, `🚫 ยกเลิกในเว็บโดย ${who.name}`);
  } catch (e) {
    return { ok: false, error: `เขียนลงชีตไม่สำเร็จ: ${e instanceof Error ? e.message : e}` };
  }
  await prisma.shopOrder.update({ where: { id }, data: { status: POS.CANCELLED } });
  revalidatePath("/stock/orders");
  return { ok: true, message: `🚫 ยกเลิก ${id} แล้ว — แจ้งร้านในแชทด้วยว่าไม่ต้องทำ` };
}

export type PostLine = {
  itemId: number;
  kind: "vehicle" | "stock";
  plate: string;
  category: string;
  itemCode: string;
  amount: number;
};

/**
 * ลงบัญชีใบสั่งงาน — รายการของรถ → ค่าใช้จ่ายรายคัน · รายการเข้าคลัง → รับเข้าคลัง
 * ตรวจทุกบรรทัดก่อน ผิดบรรทัดเดียวไม่บันทึกเลยสักบรรทัด · รายการที่ลงแล้วข้าม (กดซ้ำไม่เกิดซ้ำ)
 */
export async function postOrder(id: string, lines: PostLine[]): Promise<Result> {
  const who = await admin();
  if ("error" in who) return { ok: false, error: who.error };
  // ดึงชีตก่อนให้ได้สถานะล่าสุด · ดึงไม่ได้ก็ลงต่อได้ เพราะใบที่ร้านยืนยันราคาแล้ว ฝั่งไลน์แก้อะไรไม่ได้อีก
  const sync = await syncShopOrders();
  const o = await prisma.shopOrder.findUnique({ where: { id }, include: { items: true } });
  if (!o) return { ok: false, error: `ไม่พบใบ ${id}` };
  if (o.status !== POS.PRICED && o.status !== POS.POSTED) {
    return { ok: false, error: `${id} สถานะ «${o.status}» — ลงบัญชีได้เมื่อร้านแจ้งราคาแล้วเท่านั้น` };
  }

  const problems: string[] = [];
  const todo: { line: PostLine; item: (typeof o.items)[number] }[] = [];
  for (const l of lines) {
    const item = o.items.find((i) => i.id === l.itemId);
    if (!item) { problems.push(`❌ ไม่พบรายการ #${l.itemId} ในใบนี้`); continue; }
    const name = `${item.seq}. ${item.description}`;
    if (item.answer !== ANS.OK) { problems.push(`❌ ${name} — ร้านไม่ได้ทำรายการนี้`); continue; }
    if (item.expenseId != null || item.stockInId != null) continue; // ลงแล้ว
    if (!Number.isFinite(l.amount) || l.amount < 0) { problems.push(`❌ ${name} — ยอดเงินไม่ถูกต้อง`); continue; }
    if (l.kind === "vehicle") {
      if (!l.plate.trim()) problems.push(`❌ ${name} — ยังไม่ได้เลือกทะเบียนรถ`);
      if (!l.category.trim()) problems.push(`❌ ${name} — ยังไม่ได้เลือกประเภทค่าใช้จ่าย`);
    } else if (!l.itemCode.trim()) problems.push(`❌ ${name} — ยังไม่ได้เลือกสินค้าในคลัง`);
    todo.push({ line: l, item });
  }

  const plates = [...new Set(todo.filter((t) => t.line.kind === "vehicle").map((t) => t.line.plate.trim()))];
  const known = new Set((await prisma.vehicle.findMany({ where: { plate: { in: plates } }, select: { plate: true } })).map((v) => v.plate));
  for (const p of plates) if (p && !known.has(p)) problems.push(`❌ ทะเบียน ${p} ไม่มีในเว็บ — เพิ่มที่หน้า ข้อมูลรถ ก่อน`);
  const codes = [...new Set(todo.filter((t) => t.line.kind === "stock").map((t) => t.line.itemCode.trim()))];
  const knownItems = new Set((await prisma.inventoryItem.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((i) => i.code));
  for (const c of codes) if (c && !knownItems.has(c)) problems.push(`❌ ไม่พบสินค้ารหัส ${c} ในคลัง`);
  if (problems.length) return { ok: false, error: problems.join("\n") };
  if (!todo.length) return { ok: false, error: "ไม่มีรายการที่ต้องลงบัญชี (ลงครบแล้ว)" };

  const date = thaiDay(o.pricedAt ?? o.orderedAt);
  const now = new Date();
  let expenseSum = 0;
  let stockSum = 0;
  await prisma.$transaction(async (tx) => {
    await tx.lookup.createMany({ data: [{ kind: "supplier", value: o.shopName }], skipDuplicates: true });
    for (const { line, item } of todo) {
      const a = poLineAmounts(line.amount, item.qty);
      const edited = item.shopPrice != null && round2(item.shopPrice) !== a.amount;
      const note = `ใบสั่งงาน ${o.id} · สั่งโดย ${o.staffName || o.staffCode}${edited ? ` · ร้านแจ้ง ${item.shopPrice} แก้เป็น ${a.amount} โดย ${who.name}` : ""}`;
      if (line.kind === "vehicle") {
        const ex = await tx.expense.create({
          data: {
            date,
            plate: line.plate.trim(),
            supplier: o.shopName,
            category: line.category.trim(),
            detail: item.description,
            qty: a.qty,
            unit: item.unit,
            unitPrice: a.unitPrice,
            amount: a.amount,
            note,
          },
        });
        expenseSum += a.amount;
        await tx.shopOrderItem.update({
          where: { id: item.id },
          data: { expenseId: ex.id, postedAmount: a.amount, postedTarget: line.plate.trim(), postedCategory: line.category.trim(), postedItemCode: null, postedAt: now },
        });
      } else {
        const si = await tx.stockIn.create({
          data: { date, itemCode: line.itemCode.trim(), qty: a.qty, unitCost: a.unitPrice, vendor: o.shopName, billNo: o.id, note },
        });
        stockSum += a.amount;
        await tx.shopOrderItem.update({
          where: { id: item.id },
          data: { stockInId: si.id, postedAmount: a.amount, postedTarget: PO_STOCK, postedItemCode: line.itemCode.trim(), postedCategory: null, postedAt: now },
        });
      }
    }
  });

  const after = await prisma.shopOrderItem.findMany({ where: { orderId: id } });
  const ok = after.filter((i) => i.answer === ANS.OK);
  const done = ok.every((i) => i.expenseId != null || i.stockInId != null);
  const total = round2(ok.reduce((s, i) => s + (i.postedAmount ?? 0), 0));
  const parts = [
    ok.some((i) => i.expenseId != null) ? `ค่าใช้จ่ายรถ ${ok.filter((i) => i.expenseId != null).length} รายการ` : "",
    ok.some((i) => i.stockInId != null) ? `รับเข้าคลัง ${ok.filter((i) => i.stockInId != null).length} รายการ` : "",
  ].filter(Boolean);
  const summary = `${done ? "✅" : "⚠️"} ลงบัญชี${done ? "แล้ว" : "บางส่วน"} · ${parts.join(" · ")} · รวม ${total.toLocaleString("th-TH")} บาท · โดย ${who.name}`;
  if (done) await prisma.shopOrder.update({ where: { id }, data: { postedAt: now, postedBy: who.name, status: POS.POSTED } });

  let warning: string | undefined;
  try {
    if (!sync.ok) throw new Error(sync.error);
    await writeOrderToSheet(id, done ? POS.POSTED : null, summary);
  } catch (e) {
    warning = `⚠️ บันทึกในเว็บแล้ว แต่เขียนผลลงชีตไม่สำเร็จ (${e instanceof Error ? e.message : e}) — ไม่กระทบยอดเงิน · พนักงานที่พิมพ์ #สถานะ จะยังเห็น «แจ้งราคาแล้ว»`;
  }
  revalidatePath("/stock/orders");
  revalidatePath("/entry/expenses");
  revalidatePath("/stock/items");
  const msg = [
    expenseSum ? `ค่าใช้จ่ายรถ ${expenseSum.toLocaleString("th-TH")} บาท` : "",
    stockSum ? `รับเข้าคลัง ${stockSum.toLocaleString("th-TH")} บาท` : "",
  ].filter(Boolean).join(" · ");
  return { ok: true, message: `✅ ลงบัญชี ${id} แล้ว — ${msg}`, warning };
}
