"use client";

import { useMemo, useState } from "react";
import { Badge, Card, Empty } from "@/components/ui";
import { NO_FILTER, StockFilterBar, stockMatch, type StockFilter } from "@/components/StockFilterBar";
import { num } from "@/lib/format";
import type { StockBalanceRow } from "@/lib/reports";

/** คงเหลือรายสินค้า + ตัวกรองชุดเดียวกับหน้าคลังอะไหล่ (ค้นหา · หมวด · สถานะ) */
export function BalanceTable({ rows }: { rows: StockBalanceRow[] }) {
  const [filter, setFilter] = useState<StockFilter>(NO_FILTER);
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        stockMatch(
          { category: r.category, balance: r.balance, reorderPoint: r.reorderPoint, moved: r.inQty !== 0 || r.outQty !== 0, search: [r.code, r.name] },
          filter,
        ),
      ),
    [rows, filter],
  );
  const low = shown.filter((r) => r.needsReorder).length;

  return (
    <>
      <StockFilterBar
        value={filter}
        onChange={setFilter}
        categories={rows.map((r) => r.category)}
        summary={
          <>
            พบ {shown.length} จาก {rows.length} รายการ{low > 0 ? ` · ต้องสั่งซื้อ ${low} รายการ` : ""}
          </>
        }
      />
      <Card title="คงเหลือรายสินค้า" className="mb-4" bodyClass="p-0">
        {rows.length === 0 ? (
          <Empty>
            ยังไม่มีรายการสินค้า — เพิ่มได้ที่หน้า <b>คลังอะไหล่</b>
          </Empty>
        ) : shown.length === 0 ? (
          <Empty>ไม่มีสินค้าที่ตรงกับตัวกรอง — กด «ล้างตัวกรอง» เพื่อดูทั้งหมด</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัสสินค้า</th>
                  <th>ชื่อสินค้า</th>
                  <th>หมวด</th>
                  <th>หน่วย</th>
                  <th className="num">รับเข้าสะสม</th>
                  <th className="num">เบิกออกสะสม</th>
                  <th className="num">คงเหลือ</th>
                  <th className="num">จุดสั่งซื้อ</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code}>
                    <td className="font-mono text-[12px]">{r.code}</td>
                    <td>{r.name}</td>
                    <td className="text-slate-500">{r.category ?? "-"}</td>
                    <td className="text-slate-500">{r.unit}</td>
                    <td className="num">{num(r.inQty, 2)}</td>
                    <td className="num">{num(r.outQty, 2)}</td>
                    <td className={`num font-bold ${r.balance < 0 ? "text-red-700" : ""}`}>{num(r.balance, 2)}</td>
                    <td className="num text-slate-500">{num(r.reorderPoint, 2)}</td>
                    <td>
                      {r.balance < 0 ? (
                        <Badge tone="error">ติดลบ — ตรวจการบันทึก</Badge>
                      ) : r.needsReorder ? (
                        <Badge tone="warn">ต้องสั่งซื้อ</Badge>
                      ) : (
                        <Badge tone="ok">เพียงพอ</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
