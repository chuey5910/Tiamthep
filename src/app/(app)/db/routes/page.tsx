import { SearchFilter } from "@/components/Filters";
import { Badge, Card, Empty, Formula, PageHeader } from "@/components/ui";
import { routeKey } from "@/lib/calc";
import { compareThaiFirst } from "@/lib/sort";
import { num } from "@/lib/format";
import type { SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";
import { PriceMatrix, RouteActions, RouteForm, type RouteRow } from "./RouteEditor";

export const dynamic = "force-dynamic";

// เทียบแบบไม่สนตัวพิมพ์และช่องว่าง — "TPP บ้านค่าย" กับ "tppบ้านค่าย" ถือว่าตรงกัน
// เพราะจุดประสงค์ของช่องค้นหาคือดูว่าเส้นทางนี้มีแล้วหรือยัง สะกดไว้แบบไหน
const fold = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, "");

/** รวมชื่อจากรายการตัวเลือกกับชื่อที่เส้นทางใช้อยู่จริง แล้วเรียงตามตัวอักษร (ไทยก่อน อังกฤษทีหลัง) */
function unionOptions(lookup: string[], inUse: string[]) {
  const all = [...new Set([...lookup, ...inUse.filter(Boolean)])].sort(compareThaiFirst);
  return all.map((v) => ({ value: v, label: v }));
}

export default async function RoutesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const editId = typeof sp.edit === "string" ? Number(sp.edit) : null;
  const priceRouteId = typeof sp.route === "string" ? Number(sp.route) : null;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  // ลิงก์แก้ไข/ตั้งราคา/ยกเลิก ต้องพาคำค้นติดไปด้วย กลับมาแล้วตารางยังกรองเหมือนเดิม
  const backHref = q ? `?q=${encodeURIComponent(q)}` : "?";

  const [routes, bands, locations, vehicleTypes] = await Promise.all([
    prisma.route.findMany({
      orderBy: [{ origin: "asc" }, { destination: "asc" }, { vehicleType: "asc" }],
      include: { _count: { select: { prices: true } } },
    }),
    prisma.priceBand.findMany({ orderBy: { sort: "asc" } }),
    prisma.lookup.findMany({ where: { kind: "location" }, orderBy: [{ sort: "asc" }, { value: "asc" }] }),
    prisma.lookup.findMany({ where: { kind: "vehicleType" }, orderBy: [{ sort: "asc" }, { value: "asc" }] }),
  ]);

  // ตารางเรียงตามตัวอักษรไทยก่อน (ฐานข้อมูลเรียงตามรหัสตัวอักษร ชื่อไทยจะไปกองท้าย)
  routes.sort(
    (a, b) =>
      compareThaiFirst(a.origin, b.origin) ||
      compareThaiFirst(a.destination, b.destination) ||
      compareThaiFirst(a.vehicleType, b.vehicleType),
  );

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

  // แถวที่ระบบถือว่าเป็นเส้นทางเดียวกัน (สะกดต่างกันนิดหน่อย เช่น หัวลาก/รถหัวลาก) — ต้องรวมให้เหลือแถวเดียว
  // ไม่งั้นงานอาจไปจับแถวที่หน่วย/ราคาไม่ใช่ตัวที่ตั้งใจ แล้วเงินผิด
  const twinIds = new Map<number, number[]>();
  {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const k = routeKey(r.origin, r.destination, r.vehicleType);
      groups.set(k, [...(groups.get(k) ?? []), r.id]);
    }
    for (const ids of groups.values()) if (ids.length > 1) for (const id of ids) twinIds.set(id, ids.filter((x) => x !== id));
  }

  // ตัวเลือกต้นทาง/ปลายทาง/ประเภทรถ = รายการตัวเลือก + ชื่อที่เส้นทางเดิมใช้อยู่
  // เส้นทางที่นำเข้าจากไฟล์อาจใช้ชื่อที่ยังไม่มีในรายการตัวเลือก ถ้าไม่รวมเข้ามา
  // ตอนกดแก้ไข ช่องปลายทางจะว่าง แล้วบันทึกไม่ได้เพราะเลือกชื่อเดิมกลับไม่ได้
  const locationOptions = unionOptions(
    locations.map((l) => l.value),
    routes.flatMap((r) => [r.origin, r.destination]),
  );
  const vehicleTypeOptions = unionOptions(
    vehicleTypes.map((v) => v.value),
    routes.map((r) => r.vehicleType),
  );

  const fq = fold(q);
  const shown = fq
    ? rows.filter((r) => [r.origin, r.destination, r.vehicleType, r.note].some((v) => fold(v).includes(fq)))
    : rows;

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
            key={priceRoute.id}
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
            backHref={backHref}
          />
        </Card>
      )}

      <Card
        title={
          editing
            ? `แก้ไขเส้นทาง: ${editing.origin} → ${editing.destination} (${editing.vehicleType})`
            : "เพิ่มเส้นทางใหม่"
        }
        className="mb-4 no-print"
      >
        <RouteForm locations={locationOptions} vehicleTypes={vehicleTypeOptions} initial={editing} backHref={backHref} />
      </Card>

      {/* ค้นหาก่อนเพิ่ม — จะได้รู้ว่าเส้นทางนี้มีแล้วหรือยัง และสะกดชื่อไว้แบบไหน */}
      <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
        <SearchFilter value={q} placeholder="ต้นทาง ปลายทาง หรือประเภทรถ…" />
        <span className="pb-2 text-[12px] text-slate-500">
          {q ? `พบ ${shown.length} จาก ${rows.length} เส้นทาง` : `ทั้งหมด ${rows.length} เส้นทาง`}
        </span>
      </div>

      <Card bodyClass="p-0">
        {shown.length === 0 ? (
          <Empty>{q ? `ไม่พบเส้นทางที่ตรงกับ "${q}" — ยังไม่มีในระบบ เพิ่มได้จากฟอร์มด้านบน` : "ยังไม่มีเส้นทาง — เพิ่มได้จากฟอร์มด้านบน"}</Empty>
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
                {shown.map((r) => (
                  <tr key={r.id} className={r.id === editing?.id ? "bg-brand-50" : undefined}>
                    <td>
                      {r.origin}
                      <span className="ml-1 text-[10px] text-slate-400">#{r.id}</span>
                    </td>
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
                    <td>
                      {r.active ? <Badge tone="ok">ใช้งาน</Badge> : <Badge tone="muted">ปิด</Badge>}
                      {twinIds.has(r.id) && (
                        <div className="mt-1">
                          <Badge tone="warn">ซ้ำกับ #{twinIds.get(r.id)!.join(", #")} — รวมเป็นแถวเดียว</Badge>
                        </div>
                      )}
                    </td>
                    <td className="no-print">
                      <RouteActions id={r.id} backHref={backHref} />
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
