/** จัดรูปแบบตัวเลขและวันที่ให้เหมือนกันทั้งระบบ */

export function money(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return "-";
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** เงินแบบไม่มีทศนิยม ใช้ในตารางสรุปที่ต้องอ่านเร็ว */
export function baht(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "-";
  return Math.round(n).toLocaleString("th-TH");
}

export function num(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return "-";
  return n.toLocaleString("th-TH", { maximumFractionDigits: decimals });
}

export function pct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "-";
  return `${n.toFixed(1)}%`;
}

/** สีของตัวเลขกำไร/ขาดทุน */
export function profitClass(n: number): string {
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-red-700";
  return "text-slate-500";
}
