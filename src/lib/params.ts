import { endOfMonth, startOfMonth, utcDate } from "./date";

export type SearchParams = Record<string, string | string[] | undefined>;

function one(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** อ่านช่วงวันที่จาก query string — ไม่ระบุให้ใช้เดือนปัจจุบัน */
export function readRange(sp: SearchParams): { from: Date; to: Date; fromStr: string; toStr: string } {
  const now = new Date();
  const defFrom = startOfMonth(now.getFullYear(), now.getMonth() + 1);
  const defTo = endOfMonth(now.getFullYear(), now.getMonth() + 1);

  const fromStr = one(sp, "from") ?? defFrom.toISOString().slice(0, 10);
  const toStr = one(sp, "to") ?? defTo.toISOString().slice(0, 10);

  const from = new Date(fromStr + "T00:00:00Z");
  const to = new Date(toStr + "T00:00:00Z");
  const valid = (d: Date) => !isNaN(d.getTime());

  return {
    from: valid(from) ? from : defFrom,
    to: valid(to) ? to : defTo,
    fromStr: valid(from) ? fromStr : defFrom.toISOString().slice(0, 10),
    toStr: valid(to) ? toStr : defTo.toISOString().slice(0, 10),
  };
}

/** อ่านเดือน/ปีจาก query string — ไม่ระบุให้ใช้เดือนปัจจุบัน */
export function readMonth(sp: SearchParams): { year: number; month: number; from: Date; to: Date } {
  const now = new Date();
  const year = Number(one(sp, "year")) || now.getFullYear();
  const monthRaw = Number(one(sp, "month")) || now.getMonth() + 1;
  const month = Math.min(12, Math.max(1, monthRaw));
  return { year, month, from: utcDate(year, month, 1), to: endOfMonth(year, month) };
}

export function readString(sp: SearchParams, key: string, fallback = ""): string {
  return one(sp, key) ?? fallback;
}

export function readInt(sp: SearchParams, key: string, fallback = 0): number {
  const n = Number(one(sp, key));
  return Number.isFinite(n) ? n : fallback;
}
