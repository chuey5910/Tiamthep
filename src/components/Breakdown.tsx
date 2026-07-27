import { baht, pct } from "@/lib/format";
import { Empty } from "./ui";

export type BreakdownRow = { key: string; label: string; amount: number; share: number };

/**
 * กราฟแท่งแนวนอนเรียงจากมากไปน้อย + ตารางตัวเลขในตัวเดียวกัน
 *
 * ใช้สีเดียวโดยตั้งใจ — ชื่อรายการอยู่ข้างแท่งอยู่แล้ว การไล่สีต่างกันทุกแท่ง
 * ไม่ได้เพิ่มข้อมูลอะไร แต่ทำให้เทียบความยาวแท่งยากขึ้น
 * ตัวเลขและสัดส่วนติดอยู่ที่แท่งเลย จึงอ่านได้แม้พิมพ์ขาวดำ
 */
export function Breakdown({
  rows,
  unit = "บาท",
  max: maxOverride,
  limit,
}: {
  rows: BreakdownRow[];
  unit?: string;
  max?: number;
  limit?: number;
}) {
  if (!rows.length) return <Empty />;

  const shown = limit ? rows.slice(0, limit) : rows;
  const max = maxOverride ?? Math.max(...shown.map((r) => Math.abs(r.amount)), 1);
  const total = rows.reduce((a, b) => a + b.amount, 0);

  return (
    <div>
      <ul className="space-y-2">
        {shown.map((r) => {
          const w = Math.max(1.5, (Math.abs(r.amount) / max) * 100);
          const negative = r.amount < 0;
          return (
            <li key={r.key}>
              <div className="mb-0.5 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate text-slate-700" title={r.label}>
                  {r.label}
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-slate-900">
                  {baht(r.amount)}
                  <span className="ml-1.5 font-normal text-slate-400">{pct(r.share)}</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${w}%`, background: negative ? "#e51c23" : "#3a3a40" }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {limit && rows.length > limit && (
        <p className="mt-3 text-[12px] text-slate-400">
          แสดง {limit} อันดับแรกจากทั้งหมด {rows.length} รายการ — ดูครบในตารางด้านล่าง
        </p>
      )}

      <div className="mt-3 flex justify-between border-t border-[var(--border)] pt-2 text-[13px] font-bold">
        <span>รวม</span>
        <span className="tabular-nums">
          {baht(total)} {unit}
        </span>
      </div>
    </div>
  );
}

/** ตารางแสดงรายละเอียดครบทุกแถวของ breakdown (ใช้คู่กับกราฟด้านบน) */
export function BreakdownTable({
  rows,
  labelHead,
  valueHead = "จำนวนเงิน (บาท)",
}: {
  rows: BreakdownRow[];
  labelHead: string;
  valueHead?: string;
}) {
  if (!rows.length) return <Empty />;
  const total = rows.reduce((a, b) => a + b.amount, 0);
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>{labelHead}</th>
            <th className="num">{valueHead}</th>
            <th className="num">สัดส่วน</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="num">{baht(r.amount)}</td>
              <td className="num text-slate-500">{pct(r.share)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>รวม</td>
            <td className="num">{baht(total)}</td>
            <td className="num">100.0%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
