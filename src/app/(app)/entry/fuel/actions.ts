"use server";

import { requireWrite } from "@/lib/auth";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { parseDate } from "@/lib/date";
import { normalizePlate, parseFuelRows, type FuelSourceKey, type ParsedFuelRow } from "@/lib/fuel-import";

export type ImportPreview = {
  ok: boolean;
  error?: string;
  /** true = ตรวจสอบอย่างเดียว ยังไม่บันทึก */
  dryRun: boolean;
  fileName: string;
  source: string;
  parsed: number;
  imported: number;
  duplicates: number;
  /** ในจำนวน duplicates นี้ กี่แถวที่ซ้ำกันเองภายในไฟล์ (เลขสลิปเดียวกัน) */
  inFileDuplicates: number;
  unknownPlates: string[];
  unknownDrivers: string[];
  skipped: { row: number; reason: string }[];
  sample: {
    date: string;
    plate: string;
    driverCode: string | null;
    litres: number;
    pricePerL: number;
    amount: number;
    known: boolean;
  }[];
  totals: { litres: number; amount: number };
};

/** อ่านไฟล์ .xlsx / .xls / .csv เป็นตารางดิบ */
function readTable(buf: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: false, defval: null });
}

export async function importFuelFile(form: FormData): Promise<ImportPreview> {
  await requireWrite();
  const file = form.get("file");
  const source = String(form.get("source") ?? "") as FuelSourceKey;
  const dryRun = form.get("commit") !== "on";

  const empty: ImportPreview = {
    ok: false,
    dryRun,
    fileName: "",
    source,
    parsed: 0,
    imported: 0,
    duplicates: 0,
    inFileDuplicates: 0,
    unknownPlates: [],
    unknownDrivers: [],
    skipped: [],
    sample: [],
    totals: { litres: 0, amount: 0 },
  };

  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, error: "กรุณาเลือกไฟล์ที่ export มาจากระบบน้ำมัน" };
  }
  if (source !== "ปั๊มบริษัท" && source !== "FleetCard") {
    return { ...empty, error: "กรุณาเลือกรูปแบบไฟล์" };
  }

  let table: unknown[][];
  try {
    table = readTable(await file.arrayBuffer());
  } catch (e) {
    return { ...empty, fileName: file.name, error: `อ่านไฟล์ไม่สำเร็จ: ${e instanceof Error ? e.message : e}` };
  }
  if (table.length === 0) return { ...empty, fileName: file.name, error: "ไฟล์ว่าง หรืออ่านชีตแรกไม่ได้" };

  const { rows, skipped } = parseFuelRows(source, table);
  if (rows.length === 0) {
    return {
      ...empty,
      fileName: file.name,
      error: "ไม่พบแถวข้อมูลที่ใช้ได้ — ตรวจว่าเลือกรูปแบบไฟล์ถูกต้องหรือไม่",
      skipped: skipped.slice(0, 20),
    };
  }

  const [vehicles, drivers, existing] = await Promise.all([
    prisma.vehicle.findMany({ select: { plate: true } }),
    prisma.driver.findMany({ select: { code: true } }),
    prisma.fuelEntry.findMany({
      where: { source, refNo: { in: rows.map((r) => r.refNo) } },
      select: { refNo: true },
    }),
  ]);

  const knownPlates = new Set(vehicles.map((v) => v.plate));
  const knownDrivers = new Set(drivers.map((d) => d.code));
  const existingRefs = new Set(existing.map((e) => e.refNo));

  const unknownPlates = [...new Set(rows.map((r) => r.plate).filter((p) => !knownPlates.has(p)))];
  const unknownDrivers = [
    ...new Set(rows.map((r) => r.driverCode).filter((d): d is string => !!d && !knownDrivers.has(d))),
  ];

  // กันซ้ำสองชั้น: ซ้ำกับที่เคยนำเข้าไปแล้ว และซ้ำกันเองภายในไฟล์
  // (ไฟล์จริงมีเลขสลิปซ้ำได้ ถ้าปล่อยไปจะชนกฎ unique แล้วทั้งหน้าพัง)
  const seen = new Set<string>();
  const fresh: ParsedFuelRow[] = [];
  let inFileDuplicates = 0;
  for (const r of rows) {
    if (existingRefs.has(r.refNo)) continue;
    if (seen.has(r.refNo)) {
      inFileDuplicates++;
      continue;
    }
    seen.add(r.refNo);
    fresh.push(r);
  }
  const duplicates = rows.length - fresh.length;

  let imported = 0;
  if (!dryRun && fresh.length > 0) {
    // ทะเบียนที่ยังไม่มีในระบบยังนำเข้าได้ แต่จะไม่เข้ารายงานรายคันจนกว่าจะเพิ่มรถ
    const data = fresh.map((r: ParsedFuelRow) => ({
      date: r.date,
      source,
      plate: r.plate,
      driverCode: r.driverCode && knownDrivers.has(r.driverCode) ? r.driverCode : null,
      litres: r.litres,
      pricePerL: r.pricePerL,
      amount: r.amount,
      mileage: r.mileage,
      station: r.station,
      refNo: r.refNo,
    }));
    try {
      // skipDuplicates กันกรณีมีคนกดนำเข้าไฟล์เดียวกันพร้อมกันสองเครื่อง
      const res = await prisma.fuelEntry.createMany({ data, skipDuplicates: true });
      imported = res.count;
    } catch (e) {
      return {
        ...empty,
        fileName: file.name,
        parsed: rows.length,
        duplicates,
        inFileDuplicates,
        error: `บันทึกลงฐานข้อมูลไม่สำเร็จ: ${e instanceof Error ? e.message.split("\n").slice(-1)[0] : e}`,
        skipped: skipped.slice(0, 20),
      };
    }
    revalidatePath("/", "layout");
  }

  return {
    ok: true,
    dryRun,
    fileName: file.name,
    source,
    parsed: rows.length,
    imported,
    duplicates,
    inFileDuplicates,
    unknownPlates,
    unknownDrivers,
    skipped: skipped.slice(0, 20),
    sample: fresh.slice(0, 15).map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      plate: r.plate,
      driverCode: r.driverCode,
      litres: r.litres,
      pricePerL: r.pricePerL,
      amount: r.amount,
      known: knownPlates.has(r.plate),
    })),
    totals: {
      litres: Math.round(fresh.reduce((a, r) => a + r.litres, 0) * 100) / 100,
      amount: Math.round(fresh.reduce((a, r) => a + r.amount, 0) * 100) / 100,
    },
  };
}

/** เพิ่มรายการเติมน้ำมันทีละรายการ (กรณีเติมนอกระบบ หรือแก้ตกหล่น) */
export async function addFuelEntry(form: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireWrite();
  const date = parseDate(String(form.get("date") ?? ""));
  if (!date) return { ok: false, error: "กรุณากรอกวันที่" };

  const plate = normalizePlate(String(form.get("plate") ?? ""));
  if (!plate) return { ok: false, error: "กรุณาเลือกทะเบียนรถ" };

  const litres = Number(form.get("litres") ?? 0);
  let amount = Number(form.get("amount") ?? 0);
  let pricePerL = Number(form.get("pricePerL") ?? 0);

  if (!(litres > 0)) return { ok: false, error: "จำนวนลิตรต้องมากกว่า 0" };
  if (!(amount > 0) && pricePerL > 0) amount = Math.round(litres * pricePerL * 100) / 100;
  if (!(pricePerL > 0) && amount > 0) pricePerL = Math.round((amount / litres) * 100) / 100;
  if (!(amount > 0)) return { ok: false, error: "กรุณากรอกราคาต่อลิตร หรือจำนวนเงิน" };

  const driverCode = String(form.get("driverCode") ?? "").trim() || null;
  const source = String(form.get("source") ?? "ปั๊มบริษัท");

  try {
    await prisma.fuelEntry.create({
      data: {
        date,
        source,
        plate,
        driverCode,
        litres,
        pricePerL,
        amount,
        refNo: `MANUAL-${Date.now()}`,
        note: String(form.get("note") ?? "").trim() || "บันทึกเอง",
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteFuelEntry(id: number): Promise<{ ok: boolean; error?: string }> {
  await requireWrite();
  try {
    await prisma.fuelEntry.delete({ where: { id } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
