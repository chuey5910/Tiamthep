"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth";
import { buildContext, routeKey } from "@/lib/calc";
import { parseDate, toInputDate } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { SHIP, pullShipTickets } from "@/lib/ship-ticket";
import { nameKey } from "@/lib/ship-ticket-parse";

export type ShipResult = { ok: true; message: string } | { ok: false; error: string };

export type ConfirmInput = { id: number; ticketNo: string; date: string; netKg: string; driverCode: string };

/** ดึงรูปใหม่จากชีต (ปุ่ม 🔄) */
export async function refreshShipTickets(): Promise<ShipResult> {
  await requireWrite();
  const r = await pullShipTickets();
  revalidatePath("/", "layout");
  return r.ok ? { ok: true, message: r.added ? `✅ ได้ตั๋วใหม่ ${r.added} ใบ` : "✅ ไม่มีรูปใหม่" } : { ok: false, error: r.error };
}

/**
 * ยืนยันตั๋ว 1 ใบ → สร้างงาน
 * ตรวจซ้ำฝั่งเซิร์ฟเวอร์ทุกช่อง (ไม่เชื่อค่าจากหน้าเว็บเฉยๆ) · กดซ้ำ/เปิดสองจอก็ไม่เกิดงานซ้ำ
 */
async function confirmOne(input: ConfirmInput, userName: string): Promise<ShipResult> {
  const t = await prisma.shipTicket.findUnique({ where: { id: input.id } });
  if (!t) return { ok: false, error: "ไม่พบตั๋วนี้ — กดโหลดหน้าใหม่" };
  if (t.status !== "รอตรวจ") return { ok: false, error: `ตั๋วนี้${t.status}ไปแล้ว — กดโหลดหน้าใหม่` };

  const ticketNo = input.ticketNo.trim();
  if (!/^\d{4,12}$/.test(ticketNo)) return { ok: false, error: "❌ กรอกเลขที่ตั๋ว (ตัวเลข) ก่อน" };
  const date = parseDate(input.date);
  if (!date) return { ok: false, error: "❌ กรอกวันที่ก่อน" };
  const netKg = Number(String(input.netKg).replace(/,/g, ""));
  if (!(netKg > 0 && netKg < 90000)) return { ok: false, error: "❌ กรอกน้ำหนักสุทธิ (กก.) ก่อน" };

  const ctx = await buildContext();
  const customer = ctx.customers.find((c) => c.code.trim().toUpperCase() === SHIP.customerCode);
  if (!customer) return { ok: false, error: `❌ ไม่พบลูกค้ารหัส ${SHIP.customerCode} — เพิ่มที่หน้า ข้อมูลลูกค้า` };
  const vehicle = ctx.vehicleByPlate.get(t.folderPlate);
  if (!vehicle) return { ok: false, error: `❌ ไม่พบทะเบียน ${t.folderPlate} ในข้อมูลรถ` };

  const driverCode = input.driverCode.trim().toUpperCase();
  if (!driverCode) return { ok: false, error: "⚠️ เลือก พขร. ก่อน" };
  const driver = await prisma.driver.findUnique({ where: { code: driverCode } });
  if (!driver) return { ok: false, error: `❌ ไม่พบ พขร. รหัส ${driverCode}` };

  const route = ctx.routeByKey.get(routeKey(SHIP.origin, SHIP.destination, vehicle.vehicleType)) ?? null;
  const tons = Math.round(netKg) / 1000;

  const job = await prisma.$transaction(async (tx) => {
    // จองตั๋วก่อน — ถ้าอีกจอยืนยันไปแล้ว ตรงนี้ได้ 0 แถว แล้วยกเลิกทั้งก้อน
    const lock = await tx.shipTicket.updateMany({
      where: { id: t.id, status: "รอตรวจ" },
      data: { status: "ยืนยันแล้ว", decidedBy: userName, decidedAt: new Date() },
    });
    if (lock.count === 0) throw new Error("ตั๋วนี้ถูกยืนยันไปแล้ว — กดโหลดหน้าใหม่");
    const created = await tx.job.create({
      data: {
        loadDate: date,
        unloadDate: date,
        tripCode: `${t.folderPlate}-${toInputDate(date).split("-").reverse().join("")}`,
        headPlate: t.folderPlate,
        trailerPlate: null, // รถเดี่ยว — ไม่มีหาง
        driverCode,
        customerId: customer.id,
        origin: SHIP.origin,
        destination: SHIP.destination,
        // น้ำหนักปลายทาง = น้ำหนักต้นทาง ตามที่เจ้าของกำหนดสำหรับงานตั๋วเรือ
        weightOrigin: tons,
        weightDest: tons,
        ticketOrigin: ticketNo,
        routeId: route?.id ?? null,
        note: `ตั๋วเรือ · รูป ${t.fileName}${t.part > 1 ? ` ใบที่ ${t.part}` : ""}`,
      },
    });
    await tx.shipTicket.update({ where: { id: t.id }, data: { jobId: created.id } });
    // ระบบ "จำ" ชื่อในตั๋ว → พขร. ที่คนยืนยัน ครั้งหน้าชื่อนี้ไม่ต้องเลือกซ้ำ
    if (t.driverNameOnTicket) {
      const raw = nameKey(t.driverNameOnTicket);
      await tx.ocrAlias.upsert({
        where: { kind_raw: { kind: "driver", raw } },
        update: { value: driverCode },
        create: { kind: "driver", raw, value: driverCode },
      });
    }
    return created;
  });

  const tail = route ? "" : " · ⚠️ ยังไม่มีราคาเส้นทางนี้ ไปตั้งที่หน้าเส้นทาง";
  return { ok: true, message: `✅ บันทึกเป็นงาน #${job.id} แล้ว${tail}` };
}

export async function confirmShipTicket(input: ConfirmInput): Promise<ShipResult> {
  const user = await requireWrite();
  try {
    const r = await confirmOne(input, user.name);
    revalidatePath("/", "layout");
    return r;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ยืนยันไม่สำเร็จ" };
  }
}

/** ยืนยันทีเดียวหลายใบ (เฉพาะแถวที่ไม่มีตัวแดง/คำเตือน — หน้าเว็บคัดมาให้แล้ว ฝั่งนี้ตรวจซ้ำทุกใบ) */
export async function confirmShipTickets(inputs: ConfirmInput[]): Promise<ShipResult> {
  const user = await requireWrite();
  let done = 0;
  const errors: string[] = [];
  for (const input of inputs) {
    try {
      const r = await confirmOne(input, user.name);
      if (r.ok) done++;
      else errors.push(r.error);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  revalidatePath("/", "layout");
  if (errors.length) return { ok: false, error: `ยืนยันได้ ${done} ใบ · ไม่ผ่าน ${errors.length} ใบ: ${errors[0]}` };
  return { ok: true, message: `✅ บันทึกเป็นงานแล้ว ${done} ใบ` };
}

/** ไม่ใช้ตั๋วใบนี้ (รูปซ้ำ/ไม่ใช่ตั๋ว) — กลับมาตรวจใหม่ได้ */
export async function setShipTicketUnused(id: number, unused: boolean): Promise<ShipResult> {
  const user = await requireWrite();
  const r = await prisma.shipTicket.updateMany({
    where: { id, status: unused ? "รอตรวจ" : "ไม่ใช้" },
    data: unused ? { status: "ไม่ใช้", decidedBy: user.name, decidedAt: new Date() } : { status: "รอตรวจ", decidedBy: null, decidedAt: null },
  });
  revalidatePath("/", "layout");
  return r.count ? { ok: true, message: unused ? "ย้ายไป «ไม่ใช้» แล้ว" : "กลับมารอตรวจแล้ว" } : { ok: false, error: "สถานะเปลี่ยนไปแล้ว — กดโหลดหน้าใหม่" };
}
