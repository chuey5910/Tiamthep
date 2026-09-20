import { Card, Formula, PageHeader, Stat } from "@/components/ui";
import { formatThaiDate } from "@/lib/date";
import { baht } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { sortOptionsThaiFirst } from "@/lib/sort";
import { StockHub, type ItemView, type MoveView } from "./StockHub";

export const dynamic = "force-dynamic";

/**
 * คลังอะไหล่ทั้งหมดในหน้าเดียว — รายการสินค้า + คงเหลือ + รับเข้า + เบิกใช้
 * เดิมแยกเป็น 3 หน้า ทำให้ต้องจำว่าอะไรอยู่หน้าไหน และดูคงเหลือตอนจะเบิกไม่ได้
 */
export default async function StockItemsPage() {
  const [items, ins, outs, unitLookups, supplierLookups, vehicles] = await Promise.all([
    prisma.inventoryItem.findMany({ orderBy: { code: "asc" } }),
    prisma.stockIn.findMany({ orderBy: [{ date: "asc" }, { id: "asc" }] }),
    prisma.stockOut.findMany({ orderBy: [{ date: "asc" }, { id: "asc" }] }),
    prisma.lookup.findMany({ where: { kind: "unit" }, orderBy: [{ sort: "asc" }, { value: "asc" }] }),
    prisma.lookup.findMany({ where: { kind: "supplier" }, orderBy: [{ sort: "asc" }, { value: "asc" }] }),
    prisma.vehicle.findMany({ where: { active: true }, orderBy: { plate: "asc" } }),
  ]);

  // เก็บเวลาจริงไว้เรียงก่อน แล้วค่อยแปลงวันที่เป็นข้อความตอนส่งให้หน้าจอ
  const movesByItem = new Map<string, (MoveView & { at: number })[]>();
  const push = (code: string, at: number, m: MoveView) => {
    const list = movesByItem.get(code);
    if (list) list.push({ ...m, at });
    else movesByItem.set(code, [{ ...m, at }]);
  };
  for (const r of ins) {
    push(r.itemCode, r.date.getTime() * 1000 + r.id, {
      id: r.id,
      kind: "in",
      date: formatThaiDate(r.date),
      qty: r.qty,
      money: r.unitCost,
      party: r.vendor,
      ref: r.billNo,
      plate: null,
      position: null,
      note: r.note,
    });
  }
  for (const r of outs) {
    push(r.itemCode, r.date.getTime() * 1000 + r.id, {
      id: r.id,
      kind: "out",
      date: formatThaiDate(r.date),
      qty: r.qty,
      money: r.cost,
      party: r.vendor,
      ref: r.workOrder,
      plate: r.plate,
      position: r.position,
      note: [r.newUnitCode ? `ติดตั้ง ${r.newUnitCode}` : "", r.oldUnitCode ? `ถอด ${r.oldUnitCode}` : "", r.note ?? ""]
        .filter(Boolean)
        .join(" · ") || null,
    });
  }

  const inQtyBy = new Map<string, number>();
  const outQtyBy = new Map<string, number>();
  for (const r of ins) inQtyBy.set(r.itemCode, (inQtyBy.get(r.itemCode) ?? 0) + r.qty);
  for (const r of outs) outQtyBy.set(r.itemCode, (outQtyBy.get(r.itemCode) ?? 0) + r.qty);

  // ทุนล่าสุด = ราคาต่อหน่วยของการรับเข้าครั้งหลังสุด (ins เรียงจากเก่าไปใหม่แล้ว)
  const lastCostBy = new Map<string, number>();
  for (const r of ins) lastCostBy.set(r.itemCode, r.unitCost);

  const views: ItemView[] = items.map((it) => {
    const inQty = inQtyBy.get(it.code) ?? 0;
    const outQty = outQtyBy.get(it.code) ?? 0;
    const balance = Math.round((inQty - outQty) * 100) / 100;
    const lastCost = lastCostBy.get(it.code) ?? 0;
    const moves = (movesByItem.get(it.code) ?? [])
      .sort((a, b) => a.at - b.at)
      .map(({ at: _at, ...m }) => m);
    return {
      code: it.code,
      name: it.name,
      category: it.category,
      unit: it.unit,
      trackingType: it.trackingType,
      reorderPoint: it.reorderPoint,
      note: it.note,
      inQty,
      outQty,
      balance,
      lastCost,
      value: Math.round(balance * lastCost * 100) / 100,
      lastMoveDate: moves.length ? moves[moves.length - 1].date : null,
      moves,
    };
  });

  const totals = {
    items: views.length,
    low: views.filter((v) => v.balance <= v.reorderPoint).length,
    value: views.reduce((a, v) => a + v.value, 0),
    moves: ins.length + outs.length,
  };

  return (
    <>
      <PageHeader
        title="คลังอะไหล่"
        subtitle="รายการสินค้า คงเหลือ รับเข้า และเบิกใช้ อยู่ในหน้าเดียว — กดปุ่มท้ายแถวของสินค้านั้นได้เลย"
      />

      <Formula>
        <b>คงเหลือ</b> = รับเข้าสะสม − เบิกออกสะสม ·&nbsp;
        <b>มูลค่าคงเหลือ</b> = คงเหลือ × ราคาทุนต่อหน่วยครั้งล่าสุดที่รับเข้า ·&nbsp;
        <b>ต้นทุนที่เบิก</b> เข้ารายงานกำไรขาดทุนของรถคันที่เลือกให้อัตโนมัติ ·&nbsp;
        แถวสีแดง = คงเหลือถึงจุดสั่งซื้อแล้ว
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="รายการสินค้า" value={totals.items} hint="รายการ" />
        <Stat
          label="ต้องสั่งซื้อ"
          value={totals.low}
          hint={totals.low > 0 ? "ถึงจุดสั่งซื้อแล้ว" : "ยังไม่มี"}
          tone={totals.low > 0 ? "bad" : "good"}
        />
        <Stat label="มูลค่าคงเหลือรวม" value={baht(totals.value)} hint="บาท" />
        <Stat label="ความเคลื่อนไหวทั้งหมด" value={totals.moves} hint="รายการ" />
      </div>

      <Card bodyClass="p-0">
        <div className="p-4">
          <StockHub
            items={views}
            units={sortOptionsThaiFirst(unitLookups.map((l) => ({ value: l.value, label: l.value })))}
            suppliers={sortOptionsThaiFirst(supplierLookups.map((l) => ({ value: l.value, label: l.value })))}
            vehicles={vehicles.map((v) => ({ value: v.plate, label: `${v.plate} (${v.vehicleType})` }))}
          />
        </div>
      </Card>
    </>
  );
}
