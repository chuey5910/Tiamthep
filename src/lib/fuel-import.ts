/**
 * นำเข้าข้อมูลการเติมน้ำมันจากไฟล์ที่ export มาจากระบบอื่น
 *
 * รองรับ 2 รูปแบบที่บริษัทใช้อยู่ และเพิ่มรูปแบบใหม่ได้โดยเพิ่ม config ในไฟล์นี้
 * ทุกแถวต้องมี "เลขอ้างอิง" ที่ไม่ซ้ำ ระบบจึงนำเข้าไฟล์เดิมซ้ำได้โดยไม่เกิดข้อมูลซ้ำ
 */

import { parseDate } from "./date";

export type FuelSourceKey = "ปั๊มบริษัท" | "FleetCard";

export type ParsedFuelRow = {
  date: Date;
  plate: string;
  driverCode: string | null;
  litres: number;
  pricePerL: number;
  amount: number;
  mileage: number | null;
  station: string | null;
  refNo: string;
};

export type ParseReport = {
  rows: ParsedFuelRow[];
  totalRows: number;
  skipped: { row: number; reason: string }[];
};

/** คอลัมน์ (นับจาก 1 เหมือนใน Excel) ของแต่ละรูปแบบไฟล์ */
const LAYOUTS: Record<
  FuelSourceKey,
  {
    label: string;
    describe: string;
    headerRows: number;
    date: number;
    plate: number;
    driver: number;
    /** ชื่อคนขับอยู่ในรูป "D001 สมชาย ใจดี" ต้องตัดเอาเฉพาะรหัส */
    driverIsCombined: boolean;
    litres: number;
    pricePerL: number;
    amount: number;
    mileage?: number;
    station?: number;
    refNo: number;
    /** ถ้ากำหนด จะรับเฉพาะแถวที่คอลัมน์นี้มีค่าตามที่ระบุ */
    statusCol?: number;
    statusOk?: string;
  }
> = {
  ปั๊มบริษัท: {
    label: "ปั๊มภายในบริษัท (รายงาน R-005)",
    describe:
      "คอลัมน์: รหัสสถานี / หมายเลขสลิป / รายการที่ / Job No / วันที่เติม / กลุ่มรถ / ประเภทรถ / ทะเบียน / เลขไมล์ / รหัสพนักงาน / … / จำนวน (ลิตร) / ราคา/หน่วย / จำนวนเงิน",
    headerRows: 1,
    date: 5,
    plate: 8,
    driver: 10,
    driverIsCombined: false,
    mileage: 9,
    station: 1,
    litres: 17,
    pricePerL: 18,
    amount: 19,
    refNo: 2,
  },
  FleetCard: {
    label: "Fleet Card ปั๊มภายนอก",
    describe:
      "คอลัมน์: DATE / TRANSACTION_ID / … / DRIVER_NAME / LICENSE_PLATE_NO / MILEAGE / … / UNIT_PRICE / LITRE / … / AMOUNT / STATUS",
    headerRows: 1,
    date: 1,
    plate: 14,
    driver: 13,
    driverIsCombined: true,
    mileage: 15,
    station: 6,
    pricePerL: 20,
    litres: 21,
    amount: 26,
    refNo: 2,
    statusCol: 27,
    statusOk: "สำเร็จ",
  },
};

export function fuelLayouts() {
  return (Object.keys(LAYOUTS) as FuelSourceKey[]).map((k) => ({
    key: k,
    label: LAYOUTS[k].label,
    describe: LAYOUTS[k].describe,
  }));
}

function toNumber(v: unknown): number {
  if (v == null || v === "" || v === "-") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[,\s฿]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toText(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** ตัดคำต่อท้ายทะเบียนให้เหลือเลขล้วน เพื่อให้ตรงกับฐานข้อมูลรถ */
export function normalizePlate(s: string): string {
  return s
    .replace(/\s*ลบ\.?\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * แปลงตารางดิบ (array of array) เป็นรายการเติมน้ำมัน
 * แถวที่แปลงไม่ได้จะถูกข้ามพร้อมบอกเหตุผล ไม่ทำให้ทั้งไฟล์ล้มเหลว
 */
export function parseFuelRows(source: FuelSourceKey, table: unknown[][]): ParseReport {
  const L = LAYOUTS[source];
  const rows: ParsedFuelRow[] = [];
  const skipped: { row: number; reason: string }[] = [];

  const col = (r: unknown[], n: number | undefined) => (n == null ? undefined : r[n - 1]);

  // ข้ามหัวตาราง: มองหาแถวแรกที่คอลัมน์วันที่แปลงเป็นวันที่ได้
  let start = 0;
  for (let i = 0; i < Math.min(table.length, 20); i++) {
    if (parseDate(col(table[i] ?? [], L.date) as string)) {
      start = i;
      break;
    }
  }

  for (let i = start; i < table.length; i++) {
    const r = table[i] ?? [];
    const excelRow = i + 1;

    // แถวว่างสนิท — ข้ามเงียบๆ
    if (r.every((c) => c == null || String(c).trim() === "")) continue;

    const date = parseDate(col(r, L.date) as string);
    if (!date) {
      skipped.push({ row: excelRow, reason: "อ่านวันที่ไม่ได้" });
      continue;
    }

    if (L.statusCol && L.statusOk) {
      const status = toText(col(r, L.statusCol));
      if (status && status !== L.statusOk) {
        skipped.push({ row: excelRow, reason: `สถานะรายการเป็น "${status}" (รับเฉพาะ "${L.statusOk}")` });
        continue;
      }
    }

    const plate = normalizePlate(toText(col(r, L.plate)));
    if (!plate) {
      skipped.push({ row: excelRow, reason: "ไม่มีทะเบียนรถ" });
      continue;
    }

    const driverRaw = toText(col(r, L.driver));
    let driverCode: string | null = null;
    if (driverRaw && driverRaw !== "-") {
      driverCode = L.driverIsCombined ? driverRaw.split(/\s+/)[0] : driverRaw;
      // Fleet Card บางแถวใส่ชื่อรถร่วมแทนรหัสพนักงาน — ไม่ใช่รหัส พขร.
      if (driverCode && !/^[A-Za-z]?\d{2,}$/.test(driverCode)) driverCode = null;
    }

    const litres = toNumber(col(r, L.litres));
    let amount = toNumber(col(r, L.amount));
    let pricePerL = toNumber(col(r, L.pricePerL));

    if (litres <= 0 && amount <= 0) {
      skipped.push({ row: excelRow, reason: "ไม่มีจำนวนลิตรและจำนวนเงิน" });
      continue;
    }
    // เติมค่าที่ขาดให้ครบจากสองตัวที่เหลือ
    if (amount <= 0 && litres > 0 && pricePerL > 0) amount = Math.round(litres * pricePerL * 100) / 100;
    if (pricePerL <= 0 && litres > 0 && amount > 0) pricePerL = Math.round((amount / litres) * 100) / 100;

    const refRaw = toText(col(r, L.refNo));
    const refNo = refRaw || `${source}-${plate}-${date.toISOString().slice(0, 10)}-${excelRow}`;

    const mileageVal = toNumber(col(r, L.mileage));

    rows.push({
      date,
      plate,
      driverCode,
      litres,
      pricePerL,
      amount,
      mileage: mileageVal > 0 ? mileageVal : null,
      station: toText(col(r, L.station)) || null,
      refNo,
    });
  }

  return { rows, totalRows: table.length - start, skipped };
}
