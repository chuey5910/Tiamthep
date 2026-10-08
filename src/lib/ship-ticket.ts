/**
 * ตั๋วเรือรอตรวจ — งานขนเกลือจากท่าเรือศรีราชาฮาร์เบอร์ของลูกค้า BM
 *
 * ทางเดินของข้อมูล:
 *   1. คนขับ/ออฟฟิศถ่ายรูปตั๋ว (1 รูปได้หลายใบ) เก็บใน Google Drive
 *      โฟลเดอร์ «ท่าเรือศรีราชาฮาร์เบอร์ - โกดังท่าเรือศรีราชาฮาร์เบอร์» / <ทะเบียนรถ> / รูป
 *   2. Apps Script (line-bot/Code.gs → scanShipTickets) อ่านรูปใหม่ด้วย OCR ของ Google
 *      แล้วเขียนข้อความลงแท็บ «ตั๋วเรือ» ในชีตสั่งงาน (ทำในบัญชีเจ้าของ จึงใช้ OCR ฟรีของ Drive ได้)
 *   3. เว็บดึงแท็บนั้นมาแยกเป็นทีละใบ (ship-ticket-parse.ts) เก็บเป็น ShipTicket «รอตรวจ»
 *   4. คนตรวจที่หน้า บันทึกประจำวัน › ตั๋วเรือรอตรวจ แล้วกดยืนยัน → กลายเป็นงาน (Job)
 *
 * ค่าที่ระบบรู้อยู่แล้วไม่อ่านจากรูป: ทะเบียน = ชื่อโฟลเดอร์ · ลูกค้า/ต้นทาง/ปลายทาง ตายตัว
 * · พขร. จากตารางจับคู่รถ (ชื่อในตั๋วไว้เทียบ ไม่ตรง = ให้คนเลือก)
 * น้ำหนักปลายทาง = น้ำหนักต้นทาง ตามที่เจ้าของกำหนด
 */

import { buildContext, resolveDriver, routeKey } from "./calc";
import { formatThaiDate, toInputDate } from "./date";
import { readValues, sheetConfig } from "./google-sheets";
import { nameKey, parseTicketPhoto, plateKey, weightVerified } from "./ship-ticket-parse";
import { prisma } from "./prisma";

export const SHIP = {
  /** แท็บในชีตสั่งงานที่ Apps Script เขียนผล OCR ลงไว้ — คอลัมน์ต้องตรงกับ Code.gs (SHIP_TICKET_HEADER) */
  tab: "ตั๋วเรือ",
  customerCode: "BM",
  origin: "ท่าเรือศรีราชาฮาร์เบอร์",
  destination: "โกดัง ท่าเรือศรีราชาฮาร์เบอร์",
} as const;

/** คอลัมน์ในแท็บ «ตั๋วเรือ»: เวลา · ทะเบียน(ชื่อโฟลเดอร์) · fileId · ชื่อไฟล์ · ลิงก์รูป · ข้อความ OCR */
const COL = { plate: 1, fileId: 2, fileName: 3, url: 4, ocr: 5 };

export type ShipPhoto = { fileId: string; fileName: string; url: string; plate: string; ocr: string };

/** รูป 1 รูป → ตั๋วรอตรวจทีละใบ · รูปที่เคยรับแล้วข้าม (กดดึงซ้ำกี่ครั้งก็ไม่เกิดแถวซ้ำ) */
export async function ingestPhoto(p: ShipPhoto): Promise<number> {
  const seen = await prisma.shipTicket.count({ where: { fileId: p.fileId } });
  if (seen > 0) return 0;
  const parsed = parseTicketPhoto(p.ocr);
  // อ่านไม่ออกเลยสักใบ ก็ยังต้องมีแถวให้คนเห็น ไม่งั้นรูปหายเงียบ
  const tickets = parsed.length > 0 ? parsed : [null];
  await prisma.shipTicket.createMany({
    data: tickets.map((t, i) => ({
      fileId: p.fileId,
      fileName: p.fileName,
      photoUrl: p.url,
      part: i + 1,
      folderPlate: p.plate.trim(),
      ocrText: t?.text ?? p.ocr,
      ticketNo: t?.ticketNo ?? null,
      ticketDate: t?.date ?? null,
      weightIn: t?.weightIn ?? null,
      weightOut: t?.weightOut ?? null,
      weightNet: t?.weightNet ?? null,
      plateOnTicket: t?.plate ?? null,
      driverNameOnTicket: t?.driverName ?? null,
    })),
    skipDuplicates: true,
  });
  return tickets.length;
}

/** ดึงผล OCR ใหม่จากแท็บ «ตั๋วเรือ» */
export async function pullShipTickets(): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const cfg = sheetConfig();
  // ข้อความทางเทคนิคของ sheetConfig พูดถึงไลน์/ไฟล์ตั้งค่า — หน้านี้บอกแค่สิ่งที่ผู้ใช้ต้องรู้
  if ("error" in cfg) return { ok: false, error: "เว็บเครื่องนี้ยังไม่ได้เชื่อมกับ Google Sheet ที่เก็บผลอ่านรูปตั๋ว" };
  try {
    const rows = await readValues(cfg.keyFile, cfg.sheetId, `${SHIP.tab}!A2:F`);
    let added = 0;
    for (const r of rows) {
      const fileId = (r[COL.fileId] ?? "").trim();
      if (!fileId) continue;
      added += await ingestPhoto({
        fileId,
        fileName: (r[COL.fileName] ?? "").trim(),
        url: (r[COL.url] ?? "").trim(),
        plate: (r[COL.plate] ?? "").trim(),
        ocr: r[COL.ocr] ?? "",
      });
    }
    return { ok: true, added };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Unable to parse range/i.test(msg)) {
      return { ok: false, error: `ชีตยังไม่มีแท็บ «${SHIP.tab}» — วางโค้ด Apps Script ใหม่แล้วกดเรียก setupShipTickets 1 ครั้ง` };
    }
    return { ok: false, error: msg };
  }
}

export type ShipRow = {
  id: number;
  photoUrl: string;
  fileName: string;
  part: number;
  plate: string;
  /** null = อ่านไม่ได้/ไม่ชัด → ตัวแดง เว้นว่างให้กรอก */
  ticketNo: string | null;
  date: string | null;
  dateLabel: string | null;
  /**
   * น้ำหนักต้นทาง (กก. ตามที่พิมพ์ในตั๋ว) — ปลายทางใช้ค่าเดียวกัน
   * ขึ้นให้เองเฉพาะเมื่อตรวจกับ นน.เข้า/ออก ในตั๋วแล้วลงตัว (ตรวจข้างหลัง ไม่โชว์บนจอ) ไม่ลงตัว = null ให้คนกรอก
   */
  weightKg: number | null;
  /** ค่าที่อ่านได้แต่ตรวจไม่ผ่าน — โชว์เป็นตัวช่วยในช่องกรอก ไม่ใช้เอง */
  weightHint: number | null;
  /** พขร. ที่ระบบเสนอ (null = ต้องเลือกเอง) */
  driverCode: string | null;
  driverNote: string | null;
  driverNameOnTicket: string | null;
  /** ❌ แก้ในแถวไม่ได้ ต้องไปแก้ที่อื่นก่อน */
  blockers: string[];
  /** ⚠️ ให้คนตัดสิน */
  warnings: string[];
};

export type ShipPage = {
  rows: ShipRow[];
  drivers: { code: string; name: string }[];
  /** ปัญหาระดับทั้งหน้า (เช่น ไม่มีลูกค้า BM) */
  notices: string[];
  customerId: number | null;
};

/**
 * ชื่อโฟลเดอร์ → รถในฐานข้อมูล
 * ชื่อโฟลเดอร์อาจมีชื่อจังหวัดต่อท้าย (เช่น "70-1853 ลบ") — ตรงทุกตัวก่อน ไม่ตรงค่อยเทียบเฉพาะเลขทะเบียน
 * เลขเดียวกันมีหลายคันในฐานข้อมูล = ไม่รู้ว่าคันไหน → ไม่เดา ให้แก้ชื่อโฟลเดอร์
 */
export function folderVehicle<V extends { plate: string }>(
  vehicles: Map<string, V>,
  folder: string,
): { vehicle: V; error: null } | { vehicle: null; error: string } {
  const name = folder.trim();
  const exact = vehicles.get(name);
  if (exact) return { vehicle: exact, error: null };
  const key = plateKey(name);
  const same = [...vehicles.values()].filter((v) => plateKey(v.plate) === key);
  if (same.length === 1) return { vehicle: same[0], error: null };
  if (same.length > 1)
    return { vehicle: null, error: `❌ โฟลเดอร์ ${name} ตรงกับรถหลายคัน (${same.map((v) => v.plate).join(", ")}) — ตั้งชื่อโฟลเดอร์ให้ตรงทะเบียนในหน้า ข้อมูลรถ ทุกตัว` };
  return { vehicle: null, error: `❌ ไม่พบทะเบียน ${name || "(ว่าง)"} ในข้อมูลรถ — ตั้งชื่อโฟลเดอร์ให้ตรงทะเบียน หรือเพิ่มรถที่หน้า ข้อมูลรถ` };
}

const fullName = (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName}`.trim();

/**
 * พขร. ประจำรถ ณ วันที่ในตั๋ว — งานตั๋วเรือวิ่งรถเดี่ยว (ไม่มีหาง)
 * คู่รถเดี่ยวก่อน ไม่มีค่อยใช้คู่ล่าสุดของหัวคันนั้น (พขร. ผูกกับหัว ไม่ใช่หาง)
 * ยังไงก็เทียบกับชื่อท้ายตั๋วอีกชั้น ไม่ตรง = ให้คนเลือก
 */
function pairedDriver(
  pairings: { headPlate: string; trailerPlate: string; driverCode: string | null; effectiveDate: Date }[],
  plate: string,
  date: Date,
): string | null {
  const solo = resolveDriver(pairings, plate, null, date);
  if (solo) return solo;
  let best: { driverCode: string | null; effectiveDate: Date } | null = null;
  for (const p of pairings) {
    if (p.headPlate.trim() !== plate || p.effectiveDate.getTime() > date.getTime()) continue;
    if (!best || p.effectiveDate.getTime() >= best.effectiveDate.getTime()) best = p;
  }
  return best?.driverCode ?? null;
}

/** เตรียมแถวรอตรวจ — คำนวณสถานะใหม่ทุกครั้ง แก้ข้อมูลหลัก (รถ/จับคู่/พขร.) แล้วผลอัปเดตเอง */
export async function shipReview(): Promise<ShipPage> {
  const [tickets, ctx, drivers, aliases] = await Promise.all([
    prisma.shipTicket.findMany({
      where: { status: "รอตรวจ" },
      orderBy: [{ ticketDate: "asc" }, { ticketNo: "asc" }, { id: "asc" }],
    }),
    buildContext(),
    prisma.driver.findMany({ where: { active: true } }),
    prisma.ocrAlias.findMany({ where: { kind: "driver" } }),
  ]);

  const notices: string[] = [];
  const customer = ctx.customers.find((c) => c.code.trim().toUpperCase() === SHIP.customerCode);
  if (!customer) notices.push(`❌ ไม่พบลูกค้ารหัส ${SHIP.customerCode} — เพิ่มที่หน้า ฐานข้อมูล › ข้อมูลลูกค้า ก่อน ถึงจะยืนยันได้`);

  // เลขที่ตั๋วที่มีอยู่แล้ว (ในงาน + ในตั๋วแถวอื่น) — ซ้ำ = เตือนให้คนตัดสิน ไม่ตัดทิ้งเอง
  const nos = tickets.map((t) => t.ticketNo).filter((n): n is string => !!n);
  const [jobsWithNo, othersWithNo] = await Promise.all([
    prisma.job.findMany({ where: { ticketOrigin: { in: nos } }, select: { id: true, ticketOrigin: true } }),
    prisma.shipTicket.findMany({ where: { ticketNo: { in: nos }, status: { not: "ไม่ใช้" } }, select: { id: true, ticketNo: true } }),
  ]);

  const driverByKey = new Map(drivers.map((d) => [nameKey(fullName(d)), d.code]));
  const aliasByKey = new Map(aliases.map((a) => [a.raw, a.value]));
  const driverName = new Map(drivers.map((d) => [d.code, fullName(d)]));

  // เส้นทาง/ราคายังไม่ตั้ง — บอกครั้งเดียวทั้งหน้า (บันทึกงานได้ แต่ค่าบรรทุกยังคิดไม่ได้)
  const noRoute = new Set<string>();
  const rows: ShipRow[] = tickets.map((t) => {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const found = folderVehicle(ctx.vehicleByPlate, t.folderPlate);
    const vehicle = found.vehicle;
    // ทะเบียนที่โชว์/บันทึก = ทะเบียนในฐานข้อมูล (ไม่ใช่ชื่อโฟลเดอร์ที่อาจมีชื่อจังหวัดต่อท้าย)
    const plate = vehicle?.plate ?? t.folderPlate;
    if (!vehicle) blockers.push(found.error ?? "❌ ไม่พบรถ");
    else if (!ctx.routeByKey.get(routeKey(SHIP.origin, SHIP.destination, vehicle.vehicleType)))
      noRoute.add(vehicle.vehicleType);
    if (t.plateOnTicket && plateKey(t.plateOnTicket) !== plateKey(plate))
      warnings.push(`⚠️ ทะเบียนในตั๋ว ${t.plateOnTicket} ไม่ตรงโฟลเดอร์ ${plate} — ตรวจว่าเก็บรูปผิดโฟลเดอร์ไหม`);

    const ticketNo = t.ticketNo && /^\d{10}$/.test(t.ticketNo) ? t.ticketNo : null;
    if (ticketNo) {
      const job = jobsWithNo.find((j) => j.ticketOrigin === ticketNo);
      const other = othersWithNo.find((o) => o.ticketNo === ticketNo && o.id !== t.id);
      if (job) warnings.push(`⚠️ เลขที่ตั๋วนี้มีในงาน #${job.id} แล้ว — ตรวจว่าซ้ำไหม`);
      else if (other) warnings.push("⚠️ เลขที่ตั๋วซ้ำกับอีกแถวในหน้านี้ — ถ่ายรูปซ้ำไหม");
    }

    const verified = weightVerified(t);
    const date = t.ticketDate;

    // พขร.: ตารางจับคู่รถ ณ วันที่ในตั๋ว เทียบกับชื่อท้ายตั๋ว (หรือชื่อที่คนเคยเลือกให้ไว้)
    const paired = date && vehicle ? pairedDriver(ctx.pairings, plate, date) : null;
    const key = t.driverNameOnTicket ? nameKey(t.driverNameOnTicket) : null;
    const fromTicket = key ? (aliasByKey.get(key) ?? driverByKey.get(key) ?? null) : null;
    let driverCode: string | null = null;
    let driverNote: string | null = null;
    if (paired && (!key || fromTicket === paired)) {
      driverCode = paired;
    } else if (!paired && fromTicket) {
      driverCode = fromTicket;
      driverNote = "✅ พขร. ตามชื่อในตั๋ว (ตารางจับคู่ไม่มีรถคันนี้)";
    } else if (paired && fromTicket) {
      // ชื่อในตั๋วรู้จัก (ตรงชื่อ พขร. หรือเคยเลือกไว้) แต่ไม่ใช่คนในตารางจับคู่ — เลือกตามตั๋วไว้ให้ แต่ต้องให้คนดูก่อน
      driverCode = fromTicket;
      driverNote = `⚠️ ชื่อในตั๋ว «${t.driverNameOnTicket}» ไม่ใช่คนในตารางจับคู่รถ (${driverName.get(paired) ?? paired}) — เลือกตามตั๋วไว้ให้ ตรวจแล้วกดยืนยัน`;
    } else if (paired) {
      driverNote = `⚠️ ชื่อในตั๋ว «${t.driverNameOnTicket}» ไม่ตรงตารางจับคู่รถ (${driverName.get(paired) ?? paired})`;
    } else {
      driverNote = key
        ? `⚠️ ไม่รู้จักชื่อในตั๋ว «${t.driverNameOnTicket}» และตารางจับคู่ไม่มีรถคันนี้`
        : "⚠️ อ่านชื่อในตั๋วไม่ได้ และตารางจับคู่ไม่มีรถคันนี้";
    }

    return {
      id: t.id,
      photoUrl: t.photoUrl,
      fileName: t.fileName,
      part: t.part,
      plate,
      ticketNo,
      date: date ? toInputDate(date) : null,
      dateLabel: date ? formatThaiDate(date) : null,
      weightKg: verified ? t.weightNet : null,
      weightHint: verified ? null : t.weightNet,
      driverCode,
      driverNote,
      driverNameOnTicket: t.driverNameOnTicket,
      blockers,
      warnings,
    };
  });

  for (const vt of noRoute)
    notices.push(`⚠️ ยังไม่มีเส้นทาง ${SHIP.origin} → ${SHIP.destination} สำหรับ${vt} — ยืนยันได้ แต่ค่าบรรทุกจะยังไม่ขึ้น ไปตั้งราคาที่หน้า ฐานข้อมูล › เส้นทาง ระยะทาง ราคา`);

  return {
    rows,
    drivers: drivers
      .map((d) => ({ code: d.code, name: fullName(d) }))
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
    notices,
    customerId: customer?.id ?? null,
  };
}

/** ตั๋วรอตรวจกี่ใบ — ตัวเลขข้างเมนู */
export async function shipPendingCount(): Promise<number> {
  try {
    return await prisma.shipTicket.count({ where: { status: "รอตรวจ" } });
  } catch {
    return 0;
  }
}
