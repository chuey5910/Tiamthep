/**
 * นำเข้างานจาก «ชีตสั่งงานไลน์» เข้าฐานข้อมูลเว็บ
 *
 * ขั้นตอนความปลอดภัยของข้อมูล (ห้ามลัดขั้น)
 *  1. นำเข้าเฉพาะแถวที่พนักงานตรวจแล้วและตั้งสถานะ «ยืนยัน» เท่านั้น
 *     ข้อมูลจาก OCR ที่ยังไม่ผ่านตาคน (สถานะ «ได้ตั๋วแล้ว») จะไม่ถูกแตะ
 *  2. ทุกแถวถูกตรวจกับฐานข้อมูลก่อน: ทะเบียนรถ รหัสลูกค้า รหัสคนขับ ต้องมีจริง
 *     ไม่ผ่านข้อไหนจะเขียนเหตุผลกลับลงชีต (สถานะ «นำเข้าไม่ผ่าน») ให้แก้แล้วยืนยันใหม่
 *  3. กันซ้ำสองชั้น: สถานะในชีต + รหัสงาน (sheetRef) เป็น unique ในฐานข้อมูล
 *     ต่อให้เขียนผลกลับลงชีตไม่สำเร็จ รอบถัดไปก็ไม่เกิดงานซ้ำ
 *
 * นอกจากนำเข้างานแล้ว ยังส่งข้อมูลหลักจากเว็บ (รถ/ลูกค้า/สถานที่/คนขับ)
 * ไปเติม dropdown ในชีตทุกครั้ง — ชีตกับเว็บจึงใช้รายการเดียวกันเสมอ
 */

import { prisma } from "./prisma";
import { parseDate, toInputDate } from "./date";
import { buildContext, routeKey } from "./calc";
import { batchWriteValues, clearValues, readValues, sheetConfig, writeValues } from "./google-sheets";

// ── โครงชีต — ต้องตรงกับ line-bot/Code.gs (แก้ที่หนึ่งต้องแก้อีกที่หนึ่ง) ──
const JOBS_TAB = "งาน";
const DRIVERS_TAB = "คนขับ";
const MASTER_TAB = "ฐานข้อมูล";
const JOBS_LAST_COL = "V"; // คอลัมน์สุดท้ายของแท็บงาน

// ตำแหน่งคอลัมน์ในแถวข้อมูล (index เริ่ม 0 = คอลัมน์ A)
// ตั๋วมี 2 ใบต่อ 1 งาน: ต้นทาง (ตอนรับของ) และปลายทาง (ตอนลงของ)
const C = {
  id: 0, date: 1, driver: 2, head: 4, trailer: 5, customer: 6,
  origin: 7, dest: 8, cargo: 9, note: 10, status: 11,
  ticketNoOrigin: 13, wOrigin: 14, ticketNoDest: 16, wDest: 17,
} as const;
const STATUS_COL = "L"; // = index 11
const RESULT_COL = "T"; // = index 19

const ST = {
  CONFIRMED: "ยืนยัน",
  IMPORTED: "ปิดงาน", // ดึงเข้าเว็บสำเร็จ = งานจบสมบูรณ์ ชีตจะล็อกแถวนี้ไม่ให้แก้
  FAILED: "นำเข้าไม่ผ่าน",
} as const;

export type SheetImportResult = {
  ok: boolean;
  error?: string;
  imported: number;
  failed: number;
  pendingReview: number; // แถวที่ «ส่งของเสร็จสิ้น» แล้ว แต่ออฟฟิศยังไม่กด «ยืนยัน»
  rows: { jobId: string; ok: boolean; message: string }[];
};

/** ตัวเลขจากชีต — "" คืน null, อ่านไม่ได้ก็คืน null (ให้คนตรวจ ไม่เดา) */
function numOrNull(s: string): number | null {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * ดึงงานสถานะ «ยืนยัน» จากชีตเข้าฐานข้อมูล + อัปเดตข้อมูลหลักในชีต
 * เรียกซ้ำได้เสมอ ไม่เกิดข้อมูลซ้ำ
 */
export async function runSheetImport(): Promise<SheetImportResult> {
  const cfg = sheetConfig();
  if ("error" in cfg) return { ok: false, error: cfg.error, imported: 0, failed: 0, pendingReview: 0, rows: [] };
  const { sheetId, keyFile } = cfg;

  try {
    const values = await readValues(keyFile, sheetId, `${JOBS_TAB}!A2:${JOBS_LAST_COL}`);
    const ctx = await buildContext();
    const drivers = await prisma.driver.findMany();
    const driverByCode = new Map(drivers.map((d) => [d.code.toUpperCase(), d]));
    const customerByCode = new Map(ctx.customers.map((c) => [c.code.trim().toUpperCase(), c]));

    const results: SheetImportResult["rows"] = [];
    const writes: { range: string; values: string[][] }[] = [];
    let imported = 0;
    let failed = 0;
    let pendingReview = 0;

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const rowNo = i + 2; // แถวจริงในชีต (ข้อมูลเริ่มแถว 2)
      const status = (row[C.status] ?? "").trim();
      if (status === "ส่งของเสร็จสิ้น") pendingReview++;
      if (status !== ST.CONFIRMED) continue;

      const jobId = (row[C.id] ?? "").trim();
      const res = await importRow(row, jobId, ctx, driverByCode, customerByCode);

      if (res.ok) {
        imported++;
        writes.push(
          { range: `${JOBS_TAB}!${STATUS_COL}${rowNo}`, values: [[ST.IMPORTED]] },
          { range: `${JOBS_TAB}!${RESULT_COL}${rowNo}`, values: [[res.message]] },
        );
      } else {
        failed++;
        writes.push(
          { range: `${JOBS_TAB}!${STATUS_COL}${rowNo}`, values: [[ST.FAILED]] },
          { range: `${JOBS_TAB}!${RESULT_COL}${rowNo}`, values: [[res.message]] },
        );
      }
      results.push({ jobId: jobId || `แถว ${rowNo}`, ok: res.ok, message: res.message });
    }

    // เขียนผลกลับลงชีตเป็นชุดเดียว
    await batchWriteValues(keyFile, sheetId, writes);

    // อัปเดตข้อมูลหลักให้ dropdown ในชีตตรงกับเว็บเสมอ
    await pushMasterData(keyFile, sheetId, ctx, drivers);

    return { ok: true, imported, failed, pendingReview, rows: results };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "เชื่อมต่อชีตไม่สำเร็จ",
      imported: 0, failed: 0, pendingReview: 0, rows: [],
    };
  }
}

/** ตรวจและบันทึก 1 แถว — คืนข้อความสั้นๆ ไว้เขียนกลับลงชีต */
async function importRow(
  row: string[],
  jobId: string,
  ctx: Awaited<ReturnType<typeof buildContext>>,
  driverByCode: Map<string, { code: string }>,
  customerByCode: Map<string, { id: number }>,
): Promise<{ ok: boolean; message: string }> {
  const problems: string[] = [];

  if (!jobId) problems.push("ไม่มีรหัสงาน (คอลัมน์ A)");

  const loadDate = parseDate(row[C.date] ?? "");
  if (!loadDate) problems.push("วันที่อ่านไม่ได้");

  const headPlate = (row[C.head] ?? "").trim();
  if (!headPlate) problems.push("ไม่ได้กรอกทะเบียนรถ");
  else if (!ctx.vehicleByPlate.has(headPlate)) problems.push(`ทะเบียน ${headPlate} ไม่มีในเว็บ (หน้า ข้อมูลรถ)`);

  const trailerPlate = (row[C.trailer] ?? "").trim() || null;
  if (trailerPlate && !ctx.vehicleByPlate.has(trailerPlate)) {
    problems.push(`ทะเบียนหาง ${trailerPlate} ไม่มีในเว็บ (หน้า ข้อมูลรถ)`);
  }

  const driverCode = (row[C.driver] ?? "").trim().toUpperCase() || null;
  if (driverCode && !driverByCode.has(driverCode)) {
    problems.push(`รหัสคนขับ ${driverCode} ไม่มีในเว็บ (หน้า ข้อมูลพนักงานขับรถ)`);
  }

  const customerCode = (row[C.customer] ?? "").trim().toUpperCase();
  const customer = customerCode ? customerByCode.get(customerCode) : undefined;
  if (!customer) problems.push(`รหัสลูกค้า ${customerCode || "(ว่าง)"} ไม่มีในเว็บ (หน้า ข้อมูลลูกค้า)`);

  const origin = (row[C.origin] ?? "").trim();
  const destination = (row[C.dest] ?? "").trim();
  if (!origin || !destination) problems.push("ต้นทาง/ปลายทางว่าง");
  else if (origin === destination) problems.push("ต้นทางกับปลายทางเป็นที่เดียวกัน");

  if (problems.length > 0) return { ok: false, message: problems.join(" · ") };

  // ทุกอย่างผ่าน — บันทึก (loadDate/customer ผ่านการตรวจแล้วแน่นอน)
  const date = loadDate!;
  const vehicle = ctx.vehicleByPlate.get(headPlate)!;
  const route = ctx.routeByKey.get(routeKey(origin, destination, vehicle.vehicleType)) ?? null;
  const tripCode = `${headPlate}-${toInputDate(date).split("-").reverse().join("")}`;

  const ticketO = (row[C.ticketNoOrigin] ?? "").trim();
  const ticketD = (row[C.ticketNoDest] ?? "").trim();
  const note = [
    ticketO ? `ตั๋วต้นทาง ${ticketO}` : "",
    ticketD ? `ตั๋วปลายทาง ${ticketD}` : "",
    (row[C.note] ?? "").trim(),
  ].filter(Boolean).join(" · ") || null;

  try {
    const job = await prisma.job.create({
      data: {
        loadDate: date,
        unloadDate: date,
        tripCode,
        headPlate,
        trailerPlate,
        driverCode,
        customerId: customer!.id,
        origin,
        destination,
        weightOrigin: numOrNull(row[C.wOrigin] ?? ""),
        weightDest: numOrNull(row[C.wDest] ?? ""),
        cargoType: (row[C.cargo] ?? "").trim() || null,
        routeId: route?.id ?? null,
        note,
        sheetRef: jobId,
      },
    });
    const routeNote = route ? "" : " (ยังจับคู่เส้นทางไม่ได้ — ไปเลือกในหน้า บันทึกงานขนส่ง)";
    return { ok: true, message: `เว็บ #${job.id}${routeNote}` };
  } catch (e) {
    // รหัสงานนี้เคยนำเข้าแล้ว (unique ชน) — ถือว่าสำเร็จ ไม่ให้เกิดซ้ำ
    if (e instanceof Error && e.message.includes("sheetRef")) {
      const existing = await prisma.job.findUnique({ where: { sheetRef: jobId } });
      return { ok: true, message: `นำเข้าไว้ก่อนแล้ว (เว็บ #${existing?.id ?? "?"})` };
    }
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 200) : "บันทึกไม่สำเร็จ" };
  }
}

/**
 * ส่งข้อมูลหลักจากเว็บไปเติมชีต
 *  • แท็บ «ฐานข้อมูล» A-E: ทะเบียนรถ / ทะเบียนหาง / รหัสลูกค้า / สถานที่ / ประเภทสินค้า (ใช้ทำ dropdown)
 *  • แท็บ «ฐานข้อมูล» F-H: รหัสคนขับ / รถประจำ / หางประจำ (จากหน้า จับคู่รถ+พขร. —
 *    ชีตใช้เติมทะเบียนรถอัตโนมัติเมื่อเลือกรหัสคนขับ)
 *  • แท็บ «คนขับ»: เพิ่มรหัสคนขับที่ยังไม่มีในชีต — "ไม่แตะ" คอลัมน์ LINE User ID ที่ผูกไว้แล้ว
 */
async function pushMasterData(
  keyFile: string,
  sheetId: string,
  ctx: Awaited<ReturnType<typeof buildContext>>,
  drivers: { code: string; firstName: string; lastName: string; active: boolean }[],
): Promise<void> {
  const activeVehicles = ctx.vehicles.filter((v) => v.active);
  const isTrailer = (t: string) => t.includes("หาง") || t.includes("พ่วง");
  const heads = activeVehicles.filter((v) => !isTrailer(v.vehicleType)).map((v) => v.plate);
  const trailersOnly = activeVehicles.filter((v) => isTrailer(v.vehicleType)).map((v) => v.plate);
  // ถ้าฐานข้อมูลไม่ได้แยกประเภทหาง ให้ใช้ทุกทะเบียนเป็นตัวเลือกของช่องหาง
  const trailers = trailersOnly.length > 0 ? trailersOnly : activeVehicles.map((v) => v.plate);

  const customers = ctx.customers.filter((c) => c.active).map((c) => c.code);
  const lookups = await prisma.lookup.findMany({ orderBy: [{ kind: "asc" }, { sort: "asc" }] });
  const locations = lookups.filter((l) => l.kind === "location").map((l) => l.value);
  const cargoTypes = lookups.filter((l) => l.kind === "cargoType").map((l) => l.value);
  // เส้นทางที่ตั้งราคาไว้ก็เป็นแหล่งชื่อสถานที่ด้วย
  for (const r of ctx.routes) {
    if (!locations.includes(r.origin)) locations.push(r.origin);
    if (!locations.includes(r.destination)) locations.push(r.destination);
  }

  // รถประจำของคนขับ — ต้องคิดสองชั้นให้ตรงกับตรรกะหน้า «จับคู่รถ+พขร.»:
  //  ชั้นที่ 1: รถแต่ละคัน (หัว+หาง) คนขับปัจจุบันคือ "แถวล่าสุดที่มีผลแล้ว" ของคันนั้น
  //  ชั้นที่ 2: จับคู่กลับ คนขับ → รถ เฉพาะจากรายการปัจจุบันเท่านั้น
  // (ถ้าดูแค่ประวัติรายคน คนที่เคยขับรถคันหนึ่งในอดีตจะได้ทะเบียนติดมาด้วย ทั้งที่รถถูกโอนให้คนอื่นแล้ว)
  const now = new Date();
  type Pairing = (typeof ctx.pairings)[number];
  const currentByVehicle = new Map<string, Pairing>();
  for (const p of ctx.pairings) {
    // ctx.pairings เรียงตาม effectiveDate จากเก่าไปใหม่ — แถวหลังจึงทับแถวก่อนได้เลย
    if (p.effectiveDate.getTime() > now.getTime()) continue;
    currentByVehicle.set(`${p.headPlate.trim()}|${p.trailerPlate.trim()}`, p);
  }
  const pairingByDriver = new Map<string, { head: string; trailer: string; since: number }>();
  for (const p of currentByVehicle.values()) {
    if (!p.driverCode) continue;
    const key = p.driverCode.toUpperCase();
    const prev = pairingByDriver.get(key);
    // คนเดียวเป็นคนขับปัจจุบันของหลายคัน (เช่น เพิ่งย้ายคัน) — ใช้คันที่จับคู่ล่าสุด
    if (!prev || p.effectiveDate.getTime() >= prev.since) {
      pairingByDriver.set(key, {
        head: p.headPlate.trim(),
        trailer: p.trailerPlate.trim(),
        since: p.effectiveDate.getTime(),
      });
    }
  }
  const pairDrivers: string[] = [];
  const pairHeads: string[] = [];
  const pairTrailers: string[] = [];
  for (const d of drivers) {
    const pair = pairingByDriver.get(d.code.toUpperCase());
    if (!d.active || !pair) continue;
    pairDrivers.push(d.code);
    pairHeads.push(pair.head);
    pairTrailers.push(pair.trailer);
  }

  const cols = [heads, trailers, customers, locations, cargoTypes, pairDrivers, pairHeads, pairTrailers];
  const maxLen = Math.max(...cols.map((c) => c.length), 1);
  const grid: string[][] = [];
  for (let i = 0; i < maxLen; i++) grid.push(cols.map((col) => col[i] ?? ""));

  await clearValues(keyFile, sheetId, `${MASTER_TAB}!A2:H`);
  await writeValues(keyFile, sheetId, `${MASTER_TAB}!A2:H${maxLen + 1}`, grid);

  // เพิ่มคนขับที่ยังไม่มีในแท็บคนขับ (คอลัมน์ A รหัส, B ชื่อ) — ค่าเดิมไม่ถูกแตะ
  const existing = await readValues(keyFile, sheetId, `${DRIVERS_TAB}!A2:A`);
  const existingCodes = new Set(existing.map((r) => (r[0] ?? "").trim().toUpperCase()).filter(Boolean));
  const missing = drivers
    .filter((d) => d.active && !existingCodes.has(d.code.toUpperCase()))
    .map((d) => [d.code, `${d.firstName} ${d.lastName}`.trim()]);
  if (missing.length > 0) {
    const startRow = existing.length + 2;
    await writeValues(keyFile, sheetId, `${DRIVERS_TAB}!A${startRow}:B${startRow + missing.length - 1}`, missing);
  }
}
