import { Badge, Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { SearchFilter } from "@/components/Filters";
import { formatThaiDate, toInputDate } from "@/lib/date";
import { baht } from "@/lib/format";
import { readString, type SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";
import { DeleteUnitButton, ScrapRowForm, SerialUnitForm } from "./UnitForms";

export const dynamic = "force-dynamic";

export default async function SerialUnitsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = readString(sp, "q").trim();

  const [units, items, suppliers, outs, scraps] = await Promise.all([
    prisma.serialUnit.findMany({
      where: q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" as const } },
              { serial: { contains: q, mode: "insensitive" as const } },
              { brand: { contains: q, mode: "insensitive" as const } },
              { itemCode: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {},
      orderBy: [{ receivedAt: "desc" }, { code: "desc" }],
      take: 500,
      include: { item: true },
    }),
    prisma.inventoryItem.findMany({ where: { trackingType: "รายชิ้น" }, orderBy: { code: "asc" } }),
    prisma.lookup.findMany({ where: { kind: "supplier" }, orderBy: { sort: "asc" } }),
    prisma.stockOut.findMany({
      where: { OR: [{ newUnitCode: { not: null } }, { oldUnitCode: { not: null } }] },
      orderBy: { date: "asc" },
    }),
    prisma.scrapPart.findMany(),
  ]);

  // ติดตั้งอยู่ที่ไหน / ถอดออกเมื่อไหร่ — ดูจากรายการเบิกใช้จริง กันการพิมพ์สถานะเองแล้วเพี้ยน
  const installedBy = new Map(outs.filter((o) => o.newUnitCode).map((o) => [o.newUnitCode!, o]));
  const removedBy = new Map(outs.filter((o) => o.oldUnitCode).map((o) => [o.oldUnitCode!, o]));
  const scrapBy = new Map(scraps.map((s) => [s.unitCode, s]));

  const statusOf = (code: string) => {
    const scrap = scrapBy.get(code);
    if (scrap && scrap.status !== "รอขาย") return scrap.status;
    if (removedBy.has(code)) return "ถอดออกแล้ว — รอขาย";
    if (installedBy.has(code)) return "ติดตั้งอยู่";
    return "อยู่ในสต็อก";
  };

  const tone = (s: string) =>
    s === "ติดตั้งอยู่" ? "info" : s === "อยู่ในสต็อก" ? "ok" : s === "ขายแล้ว" || s === "ทิ้ง" ? "muted" : "warn";

  // ของเก่ารอจัดการ = ชิ้นที่ถูกถอดออกแล้ว
  const removed = units.filter((u) => removedBy.has(u.code));

  const counts = {
    inStock: units.filter((u) => statusOf(u.code) === "อยู่ในสต็อก").length,
    installed: units.filter((u) => statusOf(u.code) === "ติดตั้งอยู่").length,
    waiting: units.filter((u) => statusOf(u.code) === "ถอดออกแล้ว — รอขาย").length,
  };
  const soldValue = scraps
    .filter((s) => s.status === "ขายแล้ว")
    .reduce((a, s) => a + (s.salePrice ?? 0), 0);

  return (
    <>
      <PageHeader
        title="ทะเบียนอุปกรณ์รายชิ้น (ยาง / แบตเตอรี่)"
        subtitle="ติดตามได้ว่ายางเส้นไหนอยู่รถคันไหน ตำแหน่งอะไร ถอดออกเมื่อไหร่ และขายไปหรือยัง"
      />

      <Formula>
        <b>สถานะคำนวณจากรายการเบิกใช้จริง</b> ไม่ให้พิมพ์เอง — ป้องกันการแก้สถานะให้ตรงกับของที่หายไป
        ·&nbsp; ตอนเบิกใช้ที่หน้า <b>เบิกใช้สต็อก</b> ให้กรอก &laquo;รหัสอุปกรณ์ใหม่ที่ติดตั้ง&raquo; และ
        &laquo;รหัสอุปกรณ์เก่าที่ถอด&raquo; ระบบจะเดินสถานะให้เอง
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="อยู่ในสต็อก" value={counts.inStock} hint="ชิ้น" tone="good" />
        <Stat label="ติดตั้งอยู่กับรถ" value={counts.installed} hint="ชิ้น" />
        <Stat label="ถอดออกแล้ว รอขาย" value={counts.waiting} hint="ชิ้น" tone={counts.waiting > 0 ? "warn" : "default"} />
        <Stat label="รายได้จากการขายของเก่า" value={baht(soldValue)} hint="บาท" />
      </div>

      <Card title="รับอุปกรณ์รายชิ้นเข้าสต็อก" className="mb-4 no-print">
        {items.length === 0 ? (
          <Empty>
            ยังไม่มีสินค้าที่ตั้งประเภทการติดตามเป็น &laquo;รายชิ้น&raquo; — ตั้งได้ที่หน้า <b>รายการสินค้า</b>
          </Empty>
        ) : (
          <SerialUnitForm
            items={items.map((i) => ({ value: i.code, label: `${i.code} — ${i.name}` }))}
            suppliers={suppliers.map((s) => ({ value: s.value, label: s.value }))}
          />
        )}
      </Card>

      <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
        <SearchFilter value={q} placeholder="รหัสอุปกรณ์ / Serial / ยี่ห้อ" />
        <span className="pb-2 text-[12px] text-slate-500">พบ {units.length.toLocaleString("th-TH")} ชิ้น</span>
      </div>

      <Card title="ทะเบียนอุปกรณ์" className="mb-4" bodyClass="p-0">
        {units.length === 0 ? (
          <Empty>ยังไม่มีอุปกรณ์รายชิ้นในระบบ</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัสอุปกรณ์</th>
                  <th>สินค้า</th>
                  <th>ยี่ห้อ / รุ่น</th>
                  <th>Serial / DOT</th>
                  <th>วันที่รับเข้า</th>
                  <th className="num">ราคาทุน</th>
                  <th>ผู้ขาย</th>
                  <th>สถานะ</th>
                  <th>ติดตั้งที่</th>
                  <th className="no-print">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => {
                  const s = statusOf(u.code);
                  const install = installedBy.get(u.code);
                  return (
                    <tr key={u.code}>
                      <td className="font-mono text-[12px] font-semibold">{u.code}</td>
                      <td>{u.item.name}</td>
                      <td className="text-slate-500">{u.brand ?? "-"}</td>
                      <td className="font-mono text-[11px] text-slate-500">{u.serial ?? "-"}</td>
                      <td className="whitespace-nowrap">{formatThaiDate(u.receivedAt)}</td>
                      <td className="num">{baht(u.cost)}</td>
                      <td className="text-slate-500">{u.vendor ?? "-"}</td>
                      <td>
                        <Badge tone={tone(s)}>{s}</Badge>
                      </td>
                      <td className="whitespace-nowrap text-slate-600">
                        {install ? `${install.plate ?? "-"}${install.position ? ` · ${install.position}` : ""}` : "-"}
                      </td>
                      <td className="no-print">
                        <DeleteUnitButton code={u.code} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="ของเก่ารอขาย / จำหน่าย"
        actions={<span className="text-[11px] font-normal text-slate-400">แก้ในตารางแล้วกดบันทึกทีละแถว</span>}
        bodyClass="p-0"
      >
        {removed.length === 0 ? (
          <Empty>
            ยังไม่มีของเก่าที่ถอดออกมา — เกิดขึ้นเมื่อกรอก &laquo;รหัสอุปกรณ์เก่าที่ถอด&raquo; ตอนเบิกใช้สต็อก
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัสอุปกรณ์</th>
                  <th>สินค้า</th>
                  <th>วันที่ถอด</th>
                  <th>ถอดจากรถ</th>
                  <th className="num">ดอกยางตอนถอด (มม.)</th>
                  <th>สถานะ</th>
                  <th>ผู้ซื้อ</th>
                  <th className="num">ราคาขาย</th>
                  <th>วันที่ขาย</th>
                  <th className="no-print">บันทึก</th>
                </tr>
              </thead>
              <tbody>
                {removed.map((u) => {
                  const out = removedBy.get(u.code)!;
                  const scrap = scrapBy.get(u.code);
                  return (
                    <tr key={u.code}>
                      <td className="font-mono text-[12px] font-semibold">{u.code}</td>
                      <td>{u.item.name}</td>
                      <td className="whitespace-nowrap">{formatThaiDate(out.date)}</td>
                      <td>
                        {out.plate ?? "-"}
                        {out.position && <span className="text-slate-400"> · {out.position}</span>}
                      </td>
                      <ScrapRowForm
                        unitCode={u.code}
                        initial={{
                          treadMm: scrap?.treadMm == null ? "" : String(scrap.treadMm),
                          status: scrap?.status ?? "รอขาย",
                          buyer: scrap?.buyer ?? "",
                          salePrice: scrap?.salePrice == null ? "" : String(scrap.salePrice),
                          soldAt: toInputDate(scrap?.soldAt),
                          note: scrap?.note ?? "",
                        }}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
