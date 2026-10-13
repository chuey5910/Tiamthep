/**
 * นำเข้าค่าใช้จ่ายจากไฟล์ Excel — อ่าน → ตรวจทีละแถว → ให้คนดูก่อน → ค่อยบันทึก
 *
 * หลักเดียวกับทั้งระบบ:
 *  – ไม่เดาแทนคน: ข้อมูลไม่ครบ/ไม่ตรงฐานข้อมูล = ❌ บอกว่าแก้ที่ไหน แถวนั้นไม่นำเข้า
 *  – เงินต้องไม่ผิด: รวมเงินในไฟล์ต้องเท่ากับ จำนวน × ราคา/หน่วย (สูตรเดียวกับฟอร์ม expenseAmount)
 *  – รายการเหมือนที่มีในระบบแล้ว "ไม่ใช่ซ้ำเสมอไป" — ติ๊กออกไว้ให้ คนตัดสินเอง
 * ตอนบันทึกอ่านไฟล์ใหม่ฝั่งเซิร์ฟเวอร์ทุกครั้ง ไม่เชื่อค่าที่หน้าเว็บส่งมา
 */

import * as XLSX from "xlsx";
import { expenseAmount } from "./calc";
import { formatThaiDate, parseDate } from "./date";
import { prisma } from "./prisma";
import { nameKey } from "./ship-ticket-parse";

/** ชื่อหัวคอลัมน์ที่รับ (ตัดช่องว่าง/วงเล็บหน่วยออกก่อนเทียบ) — ลำดับคอลัมน์ในไฟล์สลับได้ */
const HEADERS: Record<string, string[]> = {
  date: ["วันที่"],
  plate: ["ทะเบียน", "ทะเบียนรถ"],
  driver: ["คนขับ", "พขร.", "พขร", "พนักงานขับรถ"],
  supplier: ["ผู้ให้บริการ", "ร้านค้า", "อู่"],
  category: ["ประเภทค่าใช้จ่าย", "ประเภท"],
  detail: ["รายละเอียด"],
  qty: ["จำนวน"],
  unit: ["หน่วย"],
  unitPrice: ["ราคา/หน่วย", "ราคาต่อหน่วย"],
  amount: ["รวมเงิน", "ราคารวม", "จำนวนเงิน"],
  note: ["หมายเหตุ"],
};
type Col = keyof typeof HEADERS;

/** หัวคอลัมน์ของแบบฟอร์มเปล่า (ตรงกับที่ตัวอ่านรับ) */
export const TEMPLATE_HEADERS = ["วันที่", "ทะเบียน", "คนขับ", "ผู้ให้บริการ", "ประเภทค่าใช้จ่าย", "รายละเอียด", "จำนวน", "หน่วย", "ราคา/หน่วย", "รวมเงิน", "หมายเหตุ"];

const normHead = (s: unknown) => String(s ?? "").replace(/\(.*?\)/g, "").replace(/\s+/g, "").trim();

export type ImportRow = {
  /** แถวในไฟล์ (นับแบบ Excel เริ่ม 1) */
  line: number;
  date: string | null;
  plate: string | null;
  driver: string | null;
  supplier: string | null;
  category: string | null;
  detail: string | null;
  qty: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  /** ✅ / ⚠️ / ❌ ทีละข้อ */
  notes: string[];
  /** ไม่มี ❌ = นำเข้าได้ */
  ok: boolean;
  /** ติ๊กไว้ให้ตั้งแต่แรกไหม (เหมือนรายการที่มีในระบบแล้ว = ไม่ติ๊ก) */
  checked: boolean;
};

export type ImportPreview =
  | { ok: true; rows: ImportRow[]; skipped: { line: number; text: string }[]; missingHeaders: string[] }
  | { ok: false; error: string };

type Parsed = ImportRow & {
  data: {
    date: Date;
    plate: string | null;
    driverCode: string | null;
    supplier: string | null;
    category: string;
    detail: string | null;
    unitPrice: number;
    qty: number;
    unit: string | null;
    amount: number;
    note: string | null;
  } | null;
  newSupplier: string | null;
  newUnit: string | null;
};

const text = (v: unknown) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s && s !== "-" ? s : null;
};
const number = (v: unknown): number | null | "bad" => {
  if (v == null || String(v).trim() === "" || String(v).trim() === "-") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : "bad";
};
const money = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

/** อ่านไฟล์ + ตรวจทุกแถว (ยังไม่บันทึก) */
export async function parseExpenseFile(buf: Buffer): Promise<{ ok: true; rows: Parsed[]; skipped: { line: number; text: string }[]; missingHeaders: string[] } | { ok: false; error: string }> {
  let sheet: unknown[][];
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  } catch {
    return { ok: false, error: "เปิดไฟล์ไม่ได้ — ต้องเป็นไฟล์ Excel (.xlsx)" };
  }

  // หาแถวหัวตาราง: แถวแรกที่มี "วันที่" และหัวที่รู้จักอย่างน้อย 3 ช่อง
  const known = new Map<string, Col>();
  for (const [col, names] of Object.entries(HEADERS)) for (const n of names) known.set(normHead(n), col as Col);
  let headerAt = -1;
  const colIndex = new Map<Col, number>();
  for (let r = 0; r < Math.min(sheet.length, 20); r++) {
    const hits = new Map<Col, number>();
    (sheet[r] ?? []).forEach((cell, c) => {
      const col = known.get(normHead(cell));
      if (col && !hits.has(col)) hits.set(col, c);
    });
    if (hits.has("date") && hits.size >= 3) {
      headerAt = r;
      hits.forEach((c, col) => colIndex.set(col, c));
      break;
    }
  }
  if (headerAt < 0) return { ok: false, error: `ไม่พบแถวหัวตาราง — ไฟล์ต้องมีหัวคอลัมน์ เช่น ${TEMPLATE_HEADERS.slice(0, 6).join(" · ")} (โหลดแบบฟอร์มเปล่าไปกรอกได้)` };
  const missingHeaders = (["date", "category", "amount"] as Col[])
    .filter((c) => !colIndex.has(c) && !(c === "amount" && colIndex.has("unitPrice") && colIndex.has("qty")))
    .map((c) => HEADERS[c][0]);

  // ข้อมูลในระบบที่ต้องเทียบ
  const [vehicles, drivers, lookups] = await Promise.all([
    prisma.vehicle.findMany({ select: { plate: true } }),
    prisma.driver.findMany({ select: { code: true, firstName: true, lastName: true } }),
    prisma.lookup.findMany({ where: { kind: { in: ["supplier", "expenseCategory", "unit"] } }, select: { kind: true, value: true } }),
  ]);
  const plates = new Map(vehicles.map((v) => [v.plate.replace(/\s+/g, ""), v.plate]));
  const driverByName = new Map<string, string[]>();
  for (const d of drivers) {
    const k = nameKey(`${d.firstName} ${d.lastName}`);
    driverByName.set(k, [...(driverByName.get(k) ?? []), d.code]);
  }
  const driverCodes = new Map(drivers.map((d) => [d.code.toUpperCase(), d]));
  const has = (kind: string, value: string) => lookups.some((l) => l.kind === kind && l.value === value);

  const get = (row: unknown[], col: Col) => (colIndex.has(col) ? row[colIndex.get(col)!] : null);
  const rows: Parsed[] = [];
  const skipped: { line: number; text: string }[] = [];

  for (let r = headerAt + 1; r < sheet.length; r++) {
    const row = sheet[r] ?? [];
    const line = r + 1;
    if (row.every((c) => text(c) == null)) continue; // แถวว่าง

    const rawDate = get(row, "date");
    const qtyN = number(get(row, "qty"));
    const priceN = number(get(row, "unitPrice"));
    const amountN = number(get(row, "amount"));
    const category = text(get(row, "category"));
    // แถวที่ไม่มีทั้งวันที่ ประเภท และตัวเลขเงิน = ไม่ใช่รายการ (เช่น ข้อความอธิบาย) — ข้าม แต่บอกให้รู้
    if (text(rawDate) == null && !category && qtyN == null && priceN == null && amountN == null) {
      skipped.push({ line, text: row.map(text).filter(Boolean).join(" · ").slice(0, 120) });
      continue;
    }

    const notes: string[] = [];
    const bad = (s: string) => notes.push(`❌ ${s}`);
    const warn = (s: string) => notes.push(`⚠️ ${s}`);

    // วันที่
    const date = parseDate(typeof rawDate === "string" ? rawDate.trim() : rawDate);
    if (!date) bad(text(rawDate) ? `วันที่ «${text(rawDate)}» อ่านไม่ได้ — ใช้รูปแบบ วัน/เดือน/ปี เช่น 10/10/2569` : "ไม่มีวันที่ — ใส่วันที่ในไฟล์");

    // ทะเบียน (ไม่ใส่ได้ = ค่าใช้จ่ายส่วนกลาง)
    const plateText = text(get(row, "plate"));
    const plate = plateText ? (plates.get(plateText.replace(/\s+/g, "")) ?? null) : null;
    if (plateText && !plate) bad(`ไม่พบทะเบียน ${plateText} ในข้อมูลรถ — แก้ในไฟล์ให้ตรง หรือเพิ่มรถที่หน้า ข้อมูลรถ`);

    // คนขับ: ชื่อ หรือรหัส (D048)
    const driverText = text(get(row, "driver"));
    let driverCode: string | null = null;
    if (driverText) {
      const byCode = driverCodes.get(driverText.split(/\s+/)[0].toUpperCase());
      const byName = driverByName.get(nameKey(driverText.replace(/^[A-Za-z]\d+\s*/, ""))) ?? [];
      if (byCode) driverCode = byCode.code;
      else if (byName.length === 1) driverCode = byName[0];
      else if (byName.length > 1) bad(`ชื่อคนขับ «${driverText}» ตรงกับหลายคน (${byName.join(", ")}) — ใส่รหัส พขร. แทนชื่อ`);
      else bad(`ไม่รู้จักคนขับ «${driverText}» — แก้ชื่อให้ตรงหน้า ข้อมูลคนขับ หรือใส่รหัส พขร.`);
    }

    // ประเภท (ต้องมี · ต้องตรงรายการตัวเลือก — สะกดผิดแล้วรายงานแยกหมวดผิด)
    if (!category) bad("ไม่มีประเภทค่าใช้จ่าย");
    else if (!has("expenseCategory", category))
      bad(`ไม่มีประเภท «${category}» ในรายการ — แก้ให้ตรง หรือเพิ่มที่ ตั้งค่า › รายการตัวเลือก › ประเภทค่าใช้จ่าย`);

    // ผู้ให้บริการ / หน่วย — ยังไม่มีในรายการ เพิ่มให้ตอนนำเข้า
    const supplier = text(get(row, "supplier"));
    const newSupplier = supplier && !has("supplier", supplier) ? supplier : null;
    if (newSupplier) warn(`ผู้ให้บริการ «${supplier}» ยังไม่มีในรายการ — จะเพิ่มให้ตอนนำเข้า`);
    const unit = text(get(row, "unit"));
    const newUnit = unit && !has("unit", unit) ? unit : null;
    if (newUnit) warn(`หน่วย «${unit}» ยังไม่มีในรายการ — จะเพิ่มให้ตอนนำเข้า`);

    // เงิน: รวมเงิน = จำนวน × ราคา/หน่วย (สูตรเดียวกับฟอร์ม) · ไม่ใส่รวมเงิน = คำนวณให้
    let amount: number | null = null;
    let qty = 1;
    let unitPrice = 0;
    if (qtyN === "bad" || priceN === "bad" || amountN === "bad") bad("จำนวน / ราคา / รวมเงิน ต้องเป็นตัวเลข");
    else {
      qty = qtyN ?? 1;
      unitPrice = priceN ?? 0;
      if (amountN != null) {
        amount = amountN;
        if (priceN != null && expenseAmount(unitPrice, qty) !== amountN)
          bad(`รวมเงินไม่ตรง: ${money(qty)} × ${money(unitPrice)} = ${money(expenseAmount(unitPrice, qty))} แต่ไฟล์เขียน ${money(amountN)} — แก้ในไฟล์`);
      } else if (priceN != null) {
        amount = expenseAmount(unitPrice, qty);
      } else bad("ไม่มีจำนวนเงิน — ใส่ ราคา/หน่วย หรือ รวมเงิน");
      if (amount != null && amount <= 0) bad("จำนวนเงินต้องมากกว่า 0");
    }

    const ok = !notes.some((n) => n.startsWith("❌"));
    rows.push({
      line,
      date: date ? formatThaiDate(date) : null,
      plate: plate ?? plateText,
      driver: driverCode
        ? `${driverCode} ${[driverCodes.get(driverCode)?.firstName, driverCodes.get(driverCode)?.lastName].filter(Boolean).join(" ")}`
        : driverText,
      supplier,
      category,
      detail: text(get(row, "detail")),
      qty: typeof qtyN === "number" ? qtyN : null,
      unit,
      unitPrice: typeof priceN === "number" ? priceN : null,
      amount,
      notes,
      ok,
      checked: ok,
      data:
        ok && date && category && amount != null
          ? { date, plate, driverCode, supplier, category, detail: text(get(row, "detail")), unitPrice, qty, unit, amount, note: text(get(row, "note")) }
          : null,
      newSupplier,
      newUnit,
    });
  }

  // เหมือนรายการที่มีในระบบแล้ว (วันที่ · ทะเบียน · ประเภท · รายละเอียด · เงิน) — ไม่ใช่ซ้ำเสมอไป ติ๊กออกไว้ให้คนตัดสิน
  const dates = rows.flatMap((r) => (r.data ? [r.data.date] : []));
  if (dates.length) {
    const existing = await prisma.expense.findMany({
      where: { date: { gte: new Date(Math.min(...dates.map((d) => d.getTime()))), lte: new Date(Math.max(...dates.map((d) => d.getTime()))) } },
      select: { id: true, date: true, plate: true, category: true, detail: true, amount: true },
    });
    const key = (d: { date: Date; plate: string | null; category: string; detail: string | null; amount: number }) =>
      [d.date.toISOString().slice(0, 10), d.plate ?? "", d.category, (d.detail ?? "").replace(/\s+/g, ""), d.amount.toFixed(2)].join("|");
    const inDb = new Map(existing.map((e) => [key(e), e.id]));
    const seen = new Map<string, number>();
    for (const r of rows) {
      if (!r.data) continue;
      const k = key(r.data);
      const id = inDb.get(k);
      if (id != null) {
        r.notes.push(`⚠️ มีรายการ วันที่/ทะเบียน/ประเภท/รายละเอียด/เงิน เหมือนกันในระบบแล้ว (รายการ #${id}) — ติ๊กออกไว้ให้ ถ้าเป็นของจริงติ๊กกลับได้`);
        r.checked = false;
      }
      const first = seen.get(k);
      if (first != null) r.notes.push(`⚠️ เหมือนแถว ${first} ในไฟล์ — ตรวจว่าซ้ำไหม`);
      else seen.set(k, r.line);
    }
  }
  for (const r of rows) if (r.ok && r.notes.length === 0) r.notes.push("✅ ครบ");

  return { ok: true, rows, skipped, missingHeaders };
}

/** สำหรับหน้าเว็บ — ตัดข้อมูลภายในออก */
export function toPreview(rows: Parsed[]): ImportRow[] {
  return rows.map(({ data: _d, newSupplier: _s, newUnit: _u, ...r }) => r);
}

/** บันทึกแถวที่เลือก (อ่านไฟล์ใหม่แล้ว — ไม่เชื่อข้อมูลจากหน้าเว็บ) · เพิ่มผู้ให้บริการ/หน่วยที่ยังไม่มี */
export async function saveExpenseRows(rows: Parsed[], lines: number[]): Promise<{ saved: number; amount: number }> {
  const pick = rows.filter((r) => r.data && lines.includes(r.line));
  const suppliers = [...new Set(pick.map((r) => r.newSupplier).filter((s): s is string => !!s))];
  const units = [...new Set(pick.map((r) => r.newUnit).filter((s): s is string => !!s))];
  await prisma.$transaction([
    prisma.lookup.createMany({ data: suppliers.map((value) => ({ kind: "supplier", value })), skipDuplicates: true }),
    prisma.lookup.createMany({ data: units.map((value) => ({ kind: "unit", value })), skipDuplicates: true }),
    prisma.expense.createMany({ data: pick.map((r) => r.data!) }),
  ]);
  return { saved: pick.length, amount: pick.reduce((a, r) => a + r.data!.amount, 0) };
}

/** แบบฟอร์มเปล่า (หัวคอลัมน์ถูกต้อง + ตัวอย่าง 1 แถวที่ลบทิ้งได้) */
export function expenseTemplate(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
  ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "ค่าใช้จ่าย");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
