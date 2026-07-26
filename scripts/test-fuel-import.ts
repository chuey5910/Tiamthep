/** ทดสอบตัวอ่านไฟล์นำเข้าน้ำมัน กับไฟล์รูปแบบจริงของบริษัท */
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { parseFuelRows, type FuelSourceKey } from "../src/lib/fuel-import";

function read(path: string): unknown[][] {
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true, raw: false });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1, blankrows: false, raw: false, defval: null,
  });
}

const cases: [FuelSourceKey, string][] = [
  ["ปั๊มบริษัท", process.argv[2]],
  ["FleetCard", process.argv[3]],
];

for (const [source, path] of cases) {
  const table = read(path);
  const { rows, skipped } = parseFuelRows(source, table);
  console.log(`\n=== ${source} (${path}) ===`);
  console.log(`อ่านได้ ${rows.length} แถว · ข้าม ${skipped.length} แถว`);
  for (const s of skipped) console.log(`  ข้ามแถว ${s.row}: ${s.reason}`);
  for (const r of rows) {
    console.log(
      `  ${r.date.toISOString().slice(0, 10)} | ${r.plate.padEnd(10)} | พขร=${String(r.driverCode).padEnd(6)} | ` +
      `${r.litres} ล. × ${r.pricePerL} = ${r.amount} บ. | ไมล์ ${r.mileage} | ref=${r.refNo}`,
    );
  }
}
