"use server";

import * as XLSX from "xlsx";
import { requireAuth } from "@/lib/auth";
import { formatThaiDate, payPeriod } from "@/lib/date";
import { allowanceDetail, loadPeriod } from "@/lib/reports";

export type ExcelFile = { ok: true; filename: string; base64: string } | { ok: false; error: string };

/**
 * สร้างไฟล์ Excel ใบสรุปจ่ายเบี้ยเลี้ยง — 2 ชีต
 *   «สรุปรายคน» ยอดรวมของแต่ละ พขร. (เท่ากับที่เห็นบนหน้าจอ)
 *   «รายละเอียดรายขา» ทุกขาพร้อมเงินเดินทาง/ทางด่วน ไว้ให้ตรวจทานหรือเทียบกับของคนขับ
 *
 * ส่งกลับเป็น base64 แล้วให้เบราว์เซอร์บันทึกไฟล์เอง — ไม่ต้องเก็บไฟล์ไว้บนเครื่อง
 */
export async function exportAllowanceExcel(
  year: number,
  month: number,
  period: 1 | 2,
  driverCode: string,
): Promise<ExcelFile> {
  await requireAuth();
  try {
    const { from, to } = payPeriod(year, month, period);
    const data = await loadPeriod({ from, to });
    const all = allowanceDetail(data);
    const rows = driverCode ? all.filter((r) => r.driverCode === driverCode) : all;

    const head = [
      "รหัส พขร.",
      "ชื่อ-สกุล",
      "จำนวนขา",
      "เบี้ยเลี้ยงรวม",
      "หัก เงินเดินทางรับ",
      "บวก ค่าทางด่วน",
      "บวก เงินพิเศษน้ำมัน",
      "จ่ายสุทธิ",
    ];
    const summary = rows.map((r) => [
      r.driverCode,
      r.name,
      r.legs,
      r.allowance,
      -r.advance,
      r.toll,
      r.fuelBonus,
      r.netPay,
    ]);
    summary.push([
      "รวมทั้งงวด",
      "",
      rows.reduce((a, r) => a + r.legs, 0),
      rows.reduce((a, r) => a + r.allowance, 0),
      -rows.reduce((a, r) => a + r.advance, 0),
      rows.reduce((a, r) => a + r.toll, 0),
      rows.reduce((a, r) => a + r.fuelBonus, 0),
      rows.reduce((a, r) => a + r.netPay, 0),
    ]);

    const detailHead = [
      "รหัส พขร.",
      "ชื่อ-สกุล",
      "วันที่",
      "รหัสงานในชีต",
      "รหัสรอบ",
      "ทะเบียน",
      "ลูกค้า",
      "ต้นทาง",
      "ปลายทาง",
      "น้ำหนัก (ตัน)",
      "เบี้ยเลี้ยง",
      "หัก เงินเดินทางรับ",
      "บวก ค่าทางด่วน",
      "เบี้ยเลี้ยงสุทธิของขา",
    ];
    const detail: (string | number)[][] = [];
    for (const r of rows) {
      for (const l of r.legRows) {
        detail.push([
          r.driverCode,
          r.name,
          formatThaiDate(l.date),
          l.sheetRef ?? "",
          l.tripCode,
          l.plate,
          l.customer,
          l.origin,
          l.destination,
          l.weight,
          l.allowance,
          -l.advance,
          l.toll,
          l.net,
        ]);
      }
      // เงินเดินทางที่ยังจับคู่กับขาในงวดไม่ได้ — ใส่ไว้ท้ายของคนนั้น จะได้ยอดตรงกับสรุป
      for (const a of r.looseAdvances) {
        detail.push([
          r.driverCode,
          r.name,
          formatThaiDate(a.date),
          a.sheetRef ?? "",
          "(ไม่ผูกกับขาในงวด)",
          a.plate ?? "",
          "",
          "",
          a.note ?? "",
          0,
          0,
          -a.advance,
          a.toll,
          -a.advance + a.toll,
        ]);
      }
      for (const b of r.bonusRows) {
        detail.push([
          r.driverCode,
          r.name,
          formatThaiDate(b.endDate),
          "",
          b.tripCode,
          b.plate,
          "",
          "เงินพิเศษค่าน้ำมัน",
          `ประหยัด ${b.savedLitres} ลิตร × ${b.rate} บาท`,
          0,
          0,
          0,
          0,
          b.bonus,
        ]);
      }
    }

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      [`ใบสรุปจ่ายเบี้ยเลี้ยง พขร. งวดที่ ${period} · ${formatThaiDate(from)} ถึง ${formatThaiDate(to)}`],
      [],
      head,
      ...summary,
    ]);
    ws1["!cols"] = [{ wch: 10 }, { wch: 24 }, { wch: 9 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws1, "สรุปรายคน");

    const ws2 = XLSX.utils.aoa_to_sheet([detailHead, ...detail]);
    ws2["!cols"] = [
      { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 10 },
      { wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, "รายละเอียดรายขา");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    // ชื่อไฟล์ต้องเป็นอักษรอังกฤษ — เบราว์เซอร์ตัดชื่อไฟล์ภาษาไทยทิ้ง แล้วได้ไฟล์ชื่อ "download" ที่เปิดไม่ออก
    const who = driverCode ? `-${driverCode}` : "";
    return {
      ok: true,
      filename: `allowance-${year + 543}${String(month).padStart(2, "0")}-p${period}${who}.xlsx`,
      base64: buf.toString("base64"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "สร้างไฟล์ไม่สำเร็จ" };
  }
}
