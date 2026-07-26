import { Badge, Card, Empty, Formula, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";
import type { SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";
import { PriceMatrix, RouteActions, RouteForm, type RouteRow } from "./RouteEditor";

export const dynamic = "force-dynamic";

export default async function RoutesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const editId = typeof sp.edit === "string" ? Number(sp.edit) : null;
  const priceRouteId = typeof sp.route === "string" ? Number(sp.route) : null;

  const [routes, bands, locations, vehicleTypes] = await Promise.all([
    prisma.route.findMany({
      orderBy: [{ origin: "asc" }, { destination: "asc" }, { vehicleType: "asc" }],
      include: { _count: { select: { prices: true } } },
    }),
    prisma.priceBand.findMany({ orderBy: { sort: "asc" } }),
    prisma.lookup.findMany({ where: { kind: "location" }, orderBy: [{ sort: "asc" }, { value: "asc" }] }),
    prisma.lookup.findMany({ where: { kind: "vehicleType" }, orderBy: [{ sort: "asc" }, { value: "asc" }] }),
  ]);

  const rows: RouteRow[] = routes.map((r) => ({
    id: r.id,
    origin: r.origin,
    destination: r.destination,
    vehicleType: r.vehicleType,
    priceUnit: r.priceUnit,
    distanceKm: r.distanceKm,
    targetKmPerL: r.targetKmPerL,
    allowance: r.allowance,
    note: r.note,
    active: r.active,
    kpiLitres:
      r.distanceKm != null && r.targetKmPerL != null && r.targetKmPerL > 0
        ? Math.round((r.distanceKm / r.targetKmPerL) * 10) / 10
        : null,
    pricedBands: r._count.prices,
  }));

  const editing = editId ? rows.find((r) => r.id === editId) : undefined;

  const priceRoute = priceRouteId ? routes.find((r) => r.id === priceRouteId) : null;
  const prices = priceRoute
    ? await prisma.routePrice.findMany({ where: { routeId: priceRoute.id } })
    : [];

  return (
    <>
      <PageHeader
        title="เส้นทาง ระยะทาง เบี้ยเลี้ยง และราคา"
        subtitle="รวมข้อมูลเบี้ยเลี้ยง ระยะทาง ราคาลูกค้า และราคาจ่ายรถร่วม ไว้ที่เดียว — 1 แถว = 1 เส้นทาง ต่อ 1 ประเภทรถ"
      />

      <Formula>
        <b>ระยะทางเป็นขาเดียว</b> (ไม่ใช่ไป-กลับ) — ขากลับให้เพิ่มเป็นอีกแถว เพื่อกันการกรอกผิด ·&nbsp;
        <b>KPI น้ำมัน</b> = ระยะทาง ÷ อัตราสิ้นเปลืองเป้าหมาย ระบบคำนวณให้เอง ·&nbsp;
        <b>ราคา</b> ตั้งแยกตามช่วงราคาน้ำมัน กดปุ่ม &laquo;ตั้งราคา&raquo; ที่ท้ายแถว
      </Formula>

      {priceRoute && (
        <Card
          title={`ตารางราคา: ${priceRoute.origin} → ${priceRoute.destination} (${priceRoute.vehicleType})`}
          className="mb-4"
        >
          <PriceMatrix
            routeId={priceRoute.id}
            routeLabel={`${priceRoute.origin} → ${priceRoute.destination} (${priceRoute.vehicleType})`}
            priceUnit={priceRoute.priceUnit}
            bands={bands.map((b) => ({ id: b.id, label: b.label, minPrice: b.minPrice, maxPrice: b.maxPrice }))}
            prices={prices.map((p) => ({
              bandId: p.bandId,
              customerPrice: p.customerPrice,
              outsourcePrice: p.outsourcePrice,
            }))}
            otherRoutes={routes
              .filter((r) => r.id !== priceRoute.id)
              .map((r) => ({ value: String(r.id), label: `${r.origin} → ${r.destination} (${r.vehicleType})` }))}
          />
        </Card>
      )}

      <Card title={editing ? `แก้ไขเส้นทาง #${editing.id}` : "เพิ่มเส้นทางใหม่"} className="mb-4 no-print">
        <RouteForm
          locations={locations.map((l) => ({ value: l.value, label: l.value }))}
          vehicleTypes={vehicleTypes.map((v) => ({ value: v.value, label: v.value }))}
          initial={editing}
        />
      </Card>

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <Empty>ยังไม่มีเส้นทาง — เพิ่มได้จากฟอร์มด้านบน</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ต้นทาง</th>
                  <th>ปลายทาง</th>
                  <th>ประเภทรถ</th>
                  <th>หน่วยคิดราคา</th>
                  <th className="num">ระยะทางขาเดียว</th>
                  <th className="num">เป้าหมาย (กม./ล.)</th>
                  <th className="num">KPI น้ำมัน</th>
                  <th className="num">เบี้ยเลี้ยง/ขา</th>
                  <th>ราคาที่ตั้งแล้ว</th>
                  <th>สถานะ</th>
                  <th className="no-print">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.origin}</td>
                    <td>{r.destination}</td>
                    <td className="text-slate-500">{r.vehicleType}</td>
                    <td className="text-slate-500">{r.priceUnit}</td>
                    <td className="num">{r.distanceKm != null ? `${num(r.distanceKm, 1)} กม.` : "-"}</td>
                    <td className="num">{r.targetKmPerL != null ? num(r.targetKmPerL, 2) : "-"}</td>
                    <td className="num">{r.kpiLitres != null ? `${num(r.kpiLitres, 1)} ล.` : "-"}</td>
                    <td className="num">{num(r.allowance, 0)}</td>
                    <td>
                      {r.pricedBands === 0 ? (
                        <Badge tone="error">ยังไม่ตั้งราคา</Badge>
                      ) : (
                        <Badge tone="ok">
                          {r.pricedBands} / {bands.length} ช่วง
                        </Badge>
                      )}
                    </td>
                    <td>{r.active ? <Badge tone="ok">ใช้งาน</Badge> : <Badge tone="muted">ปิด</Badge>}</td>
                    <td className="no-print">
                      <RouteActions id={r.id} />
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
