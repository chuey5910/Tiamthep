import Link from "next/link";

/**
 * แบ่งตารางเป็นหน้า — ดึงข้อมูลครบทุกแถวเสมอ (ยอดรวม/ตัวนับคิดจากทุกแถว) แบ่งแค่ตอนแสดง
 * ใช้คู่กับ pageSlice() · qs = พารามิเตอร์ที่ต้องคงไว้ตอนเปลี่ยนหน้า (ตัวกรอง) ไม่ต้องใส่ page
 */
export function pageSlice<T>(rows: T[], size: number, pageParam: unknown) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, Number(pageParam) || 1));
  return { page, pages, size, total: rows.length, rows: rows.slice((page - 1) * size, page * size) };
}

export function Pager({ page, pages, size, total, qs, unit = "รายการ" }: { page: number; pages: number; size: number; total: number; qs: string; unit?: string }) {
  if (pages <= 1) return null;
  const pre = qs ? `?${qs}&` : "?";
  return (
    <div className="no-print flex flex-wrap items-center justify-center gap-2 border-t border-[var(--border)] px-4 py-3 text-[13px]">
      <span className="text-slate-600">
        แสดง{unit}ที่ {(page - 1) * size + 1}–{Math.min(page * size, total)} จาก {total.toLocaleString("th-TH")} {unit}
      </span>
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <Link key={n} href={`${pre}page=${n}`} className={`btn px-3 py-1 text-[12px] ${n === page ? "btn-primary" : "btn-ghost"}`}>
          {n}
        </Link>
      ))}
    </div>
  );
}
