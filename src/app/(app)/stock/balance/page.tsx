import Link from "next/link";
import { Badge, Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { baht, num } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { stockBalance } from "@/lib/reports";
import { formatThaiDate } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function StockBalancePage() {
  const rows = await stockBalance();

  const [ins, outs, bills, stockOuts] = await Promise.all([
    prisma.stockIn.aggregate({ _sum: { qty: true } }),
    prisma.stockOut.aggregate({ _sum: { cost: true } }),
    prisma.vendorBill.findMany({ orderBy: [{ date: "desc" }], take: 200 }),
    prisma.stockOut.findMany({ select: { workOrder: true, vendor: true, qty: true, plate: true } }),
  ]);

  // เทียบใบวางบิลกับจำนวนที่เบิกจริง — จับคู่ด้วย รหัสสั่งซ่อม + อู่ เพราะรหัสอาจซ้ำกันคนละอู่
  const orderedByKey = new Map<string, { qty: number; plate: string | null }>();
  for (const s of stockOuts) {
    if (!s.workOrder || !s.vendor) continue;
    const k = `${s.workOrder}|${s.vendor}`;
    const cur = orderedByKey.get(k);
    if (cur) cur.qty += s.qty;
    else orderedByKey.set(k, { qty: s.qty, plate: s.plate });
  }

  const checks = bills.map((b) => {
    const hit = orderedByKey.get(`${b.workOrder}|${b.vendor}`);
    const ordered = hit?.qty ?? 0;
    const diff = b.billedQty - ordered;
    return {
      ...b,
      plate: hit?.plate ?? null,
      ordered,
      diff,
      status: !hit ? "ไม่พบใบเบิก" : diff === 0 ? "ตรงกัน" : diff > 0 ? "บิลเกิน" : "บิลขาด",
    };
  });

  const mismatches = checks.filter((c) => c.status !== "ตรงกัน");
  const needsReorder = rows.filter((r) => r.needsReorder);

  return (
    <>
      <PageHeader
        title="สรุปสต็อกคงเหลือ"
        subtitle="คงเหลือ = รับเข้าสะสม − เบิกออกสะสม · ต้นทุนอะไหล่ที่เบิกไปเข้ารายงานกำไรขาดทุนของรถคันนั้นโดยอัตโนมัติ"
        actions={
          <>
            <Link href="/stock/in" className="btn btn-ghost">รับเข้าสต็อก</Link>
            <Link href="/stock/out" className="btn btn-primary">เบิกใช้สต็อก</Link>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="รายการสินค้า" value={rows.length} hint="รายการ" />
        <Stat
          label="ต้องสั่งซื้อเพิ่ม"
          value={needsReorder.length}
          hint="รายการ"
          tone={needsReorder.length > 0 ? "bad" : "good"}
        />
        <Stat label="รับเข้าสะสม" value={num(ins._sum.qty ?? 0, 2)} hint="หน่วย" />
        <Stat label="มูลค่าที่เบิกใช้สะสม" value={baht(outs._sum.cost ?? 0)} hint="บาท" />
      </div>

      <Card title="คงเหลือรายสินค้า" className="mb-4" bodyClass="p-0">
        {rows.length === 0 ? (
          <Empty>
            ยังไม่มีรายการสินค้า — เพิ่มได้ที่หน้า <b>รายการสินค้า</b>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัสสินค้า</th>
                  <th>ชื่อสินค้า</th>
                  <th>หน่วย</th>
                  <th className="num">รับเข้าสะสม</th>
                  <th className="num">เบิกออกสะสม</th>
                  <th className="num">คงเหลือ</th>
                  <th className="num">จุดสั่งซื้อ</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td className="font-mono text-[12px]">{r.code}</td>
                    <td>{r.name}</td>
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

      <Formula>
        <b>ตรวจใบวางบิลอู่:</b> ระบบจับคู่ใบวางบิลกับใบเบิกโดยใช้ <b>รหัสสั่งซ่อม + ชื่ออู่</b> ร่วมกันเสมอ
        เพราะรหัสสั่งซ่อมของคนละอู่อาจซ้ำกันได้ (ต่างคนต่างรันเลข)
      </Formula>

      <Card
        title="ตรวจใบวางบิลอู่ / ผู้ขาย"
        actions={
          mismatches.length > 0 ? (
            <Badge tone="error">ไม่ตรง {mismatches.length} ใบ</Badge>
          ) : (
            <Badge tone="ok">ตรงกันทั้งหมด</Badge>
          )
        }
        bodyClass="p-0"
      >
        {checks.length === 0 ? (
          <Empty>
            ยังไม่มีใบวางบิล — บันทึกได้ที่หน้า <b>ใบวางบิลอู่/ผู้ขาย</b>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>วันที่บิล</th>
                  <th>รหัสสั่งซ่อม</th>
                  <th>อู่ / ผู้ขาย</th>
                  <th>ทะเบียน</th>
                  <th className="num">เบิกจริง</th>
                  <th className="num">บิลเรียกเก็บ</th>
                  <th className="num">ส่วนต่าง</th>
                  <th className="num">จำนวนเงิน</th>
                  <th>ผลตรวจ</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">{formatThaiDate(c.date)}</td>
                    <td className="font-mono text-[12px]">{c.workOrder}</td>
                    <td>{c.vendor}</td>
                    <td>{c.plate ?? "-"}</td>
                    <td className="num">{num(c.ordered, 2)}</td>
                    <td className="num">{num(c.billedQty, 2)}</td>
                    <td className={`num ${c.diff !== 0 ? "font-semibold text-red-700" : "text-slate-400"}`}>
                      {c.diff === 0 ? "-" : num(c.diff, 2)}
                    </td>
                    <td className="num">{baht(c.amount)}</td>
                    <td>
                      {c.status === "ตรงกัน" ? (
                        <Badge tone="ok">ตรงกัน</Badge>
                      ) : c.status === "ไม่พบใบเบิก" ? (
                        <Badge tone="warn">ไม่พบใบเบิก</Badge>
                      ) : (
                        <Badge tone="error">{c.status}</Badge>
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
