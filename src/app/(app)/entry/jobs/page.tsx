import Link from "next/link";
import { DateRangeFilter } from "@/components/Filters";
import { Badge, Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { formatThaiDate, toInputDate } from "@/lib/date";
import { baht, num } from "@/lib/format";
import { readRange, type SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";
import { buildContext, computeJob } from "@/lib/calc";
import { JobForm, JobRowActions, type JobInitial } from "./JobForm";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = readRange(sp);
  const editId = typeof sp.edit === "string" ? Number(sp.edit) : null;
  // ?problems=1 = แสดงเฉพาะขาที่ข้อมูลยังไม่ครบ (เหมือนหน้านำเข้าน้ำมัน)
  const onlyProblems = sp.problems === "1";

  const [vehiclesRaw, customers, locations, cargoTypes, jobs, ctx] = await Promise.all([
    prisma.vehicle.findMany({ where: { active: true }, orderBy: { plate: "asc" } }),
    prisma.customer.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.lookup.findMany({ where: { kind: "location" }, orderBy: [{ sort: "asc" }, { value: "asc" }] }),
    prisma.lookup.findMany({ where: { kind: "cargoType" }, orderBy: { sort: "asc" } }),
    prisma.job.findMany({
      where: { loadDate: { gte: from, lte: to } },
      orderBy: [{ loadDate: "desc" }, { tripCode: "asc" }, { id: "asc" }],
      take: 500,
    }),
    buildContext(),
  ]);

  const editing = editId ? await prisma.job.findUnique({ where: { id: editId } }) : null;

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const calcs = jobs.map((j) => ({ job: j, calc: computeJob(ctx, j) }));
  const shown = onlyProblems ? calcs.filter((x) => x.calc.issues.length > 0) : calcs;

  const totals = {
    legs: calcs.length,
    revenue: calcs.reduce((a, x) => a + x.calc.revenue, 0),
    allowance: calcs.reduce((a, x) => a + x.calc.allowance, 0),
    kpi: calcs.reduce((a, x) => a + (x.calc.kpiLitres ?? 0), 0),
    issues: calcs.filter((x) => x.calc.issues.length > 0).length,
  };

  // ขาที่ยังไม่มีคู่ในรอบเดียวกัน — เสนอปุ่มสร้างขากลับให้
  const legsPerTrip = new Map<string, number>();
  for (const j of jobs) legsPerTrip.set(j.tripCode, (legsPerTrip.get(j.tripCode) ?? 0) + 1);

  const initial: JobInitial | undefined = editing
    ? {
        id: editing.id,
        loadDate: toInputDate(editing.loadDate),
        unloadDate: toInputDate(editing.unloadDate),
        tripCode: editing.tripCode,
        headPlate: editing.headPlate,
        trailerPlate: editing.trailerPlate ?? "",
        customerId: String(editing.customerId),
        origin: editing.origin,
        destination: editing.destination,
        weightOrigin: editing.weightOrigin == null ? "" : String(editing.weightOrigin),
        weightDest: editing.weightDest == null ? "" : String(editing.weightDest),
        cargoType: editing.cargoType ?? "",
        note: editing.note ?? "",
      }
    : undefined;

  const opt = (v: string, l: string) => ({ value: v, label: l });

  return (
    <>
      <PageHeader
        title="บันทึกงานขนส่ง"
        subtitle="1 แถว = 1 ขา — กรอกแค่ทะเบียนกับเส้นทาง ระบบหา พขร. ระยะทาง เบี้ยเลี้ยง และค่าบรรทุกให้เอง"
      />

      <Formula>
        <b>ไม่ต้องเลือก พขร. เอง</b> — ระบบดึงจากตารางจับคู่รถ ณ วันที่ทำงาน · <b>ไม่ต้องกรอกราคา</b> — ระบบหาจากตารางเส้นทาง
        เทียบกับช่วงราคาน้ำมันตามเกณฑ์ของลูกค้ารายนั้น · ถ้าคอลัมน์ &laquo;สถานะ&raquo; ขึ้นเตือน แปลว่ายังตั้งข้อมูลไม่ครบ
        ตัวเลขในรายงานจะยังไม่ถูก
      </Formula>

      <Card title={editing ? `แก้ไขงาน #${editing.id}` : "บันทึกงานใหม่"} className="mb-4 no-print">
        <JobForm
          vehicles={vehiclesRaw
            .filter((v) => !v.vehicleType.includes("หาง"))
            .map((v) => opt(v.plate, `${v.plate} (${v.vehicleType})`))}
          trailers={vehiclesRaw
            .filter((v) => v.vehicleType.includes("หาง"))
            .map((v) => opt(v.plate, `${v.plate} (${v.vehicleType})`))}
          customers={customers.map((c) => opt(String(c.id), `${c.code} — ${c.name}`))}
          locations={locations.map((l) => opt(l.value, l.value))}
          cargoTypes={cargoTypes.map((c) => opt(c.value, c.value))}
          initial={initial}
        />
      </Card>

      <DateRangeFilter from={fromStr} to={toStr} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="จำนวนขาในช่วงนี้" value={totals.legs} hint="ขา" />
        <Stat label="รายได้รวม" value={baht(totals.revenue)} hint="บาท" />
        <Stat label="เบี้ยเลี้ยงรวม" value={baht(totals.allowance)} hint="บาท" />
        <Stat
          label="ขาที่ข้อมูลยังไม่ครบ"
          value={totals.issues}
          hint={totals.issues > 0 ? "ต้องแก้ก่อนตัวเลขจะถูก" : "ครบทุกขา"}
          tone={totals.issues > 0 ? "bad" : "good"}
        />
      </div>

      <div className="no-print mb-2 flex flex-wrap items-center gap-2">
        <Link
          href={`?from=${fromStr}&to=${toStr}`}
          className={`btn px-3 py-1 text-[12px] ${onlyProblems ? "btn-ghost" : "btn-primary"}`}
        >
          ทุกขา ({calcs.length})
        </Link>
        <Link
          href={`?from=${fromStr}&to=${toStr}&problems=1`}
          className={`btn px-3 py-1 text-[12px] ${onlyProblems ? "btn-primary" : "btn-ghost"}`}
        >
          เฉพาะขาที่ต้องแก้ ({totals.issues})
        </Link>
        {onlyProblems && (
          <span className="text-[12px] text-slate-500">
            ซ่อนขาที่ข้อมูลครบถ้วนแล้ว {calcs.length - totals.issues} ขา
          </span>
        )}
      </div>

      <Card bodyClass="p-0">
        {shown.length === 0 ? (
          <Empty>{onlyProblems ? "ไม่มีขาที่ต้องแก้ในช่วงนี้ — ข้อมูลครบทุกขา" : "ยังไม่มีงานในช่วงวันที่นี้"}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>รหัสรอบ</th>
                  <th>ทะเบียน</th>
                  <th>พขร. (อัตโนมัติ)</th>
                  <th>ลูกค้า</th>
                  <th>เส้นทาง</th>
                  <th className="num">น้ำหนักคิดราคา</th>
                  <th className="num">ระยะทาง</th>
                  <th className="num">KPI น้ำมัน</th>
                  <th className="num">เบี้ยเลี้ยง</th>
                  <th>ช่วงราคาน้ำมัน</th>
                  <th className="num">รายได้</th>
                  <th>สถานะ</th>
                  <th className="no-print">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ job, calc }) => {
                  const customer = customerById.get(job.customerId);
                  // ระบายแดงเฉพาะช่องที่เป็นต้นเหตุ ให้เห็นตำแหน่งที่ต้องแก้ทันที
                  const bad = (f: string) =>
                    calc.badFields.includes(f as never) ? " bg-red-50 font-semibold text-red-700" : "";
                  return (
                    <tr key={job.id}>
                      <td className="whitespace-nowrap">{formatThaiDate(job.loadDate)}</td>
                      <td className="font-mono text-[11px] text-slate-500">{job.tripCode}</td>
                      <td className={`whitespace-nowrap font-medium${bad("plate")}`}>
                        {job.headPlate}
                        {job.trailerPlate && <span className="text-slate-400"> + {job.trailerPlate}</span>}
                      </td>
                      <td className={bad("driver") + bad("outsource")}>
                        {calc.ownerType === "รถร่วม" ? (
                          <Badge tone="info">{calc.partnerName ?? "รถร่วม"}</Badge>
                        ) : (
                          calc.driverCode ?? <span className="text-red-600">ไม่พบ</span>
                        )}
                      </td>
                      <td>{customer?.code ?? "-"}</td>
                      <td className={`whitespace-nowrap${bad("route")}`}>
                        {job.origin} → {job.destination}
                      </td>
                      <td className={`num${bad("weight")}`}>
                        {num(calc.billingWeight, 2)}
                        <span className="ml-1 text-[10px] text-slate-400">
                          {customer?.weightBasis === "น้ำหนักต้นทาง" ? "ต้นทาง" : "ปลายทาง"}
                        </span>
                      </td>
                      <td className="num text-slate-500">{calc.distanceKm != null ? `${num(calc.distanceKm, 0)} กม.` : "-"}</td>
                      <td className="num text-slate-500">{calc.kpiLitres != null ? `${num(calc.kpiLitres, 1)} ล.` : "-"}</td>
                      <td className="num text-slate-500">{calc.allowance ? baht(calc.allowance) : "-"}</td>
                      <td className={`whitespace-nowrap text-[12px] text-slate-500${bad("price")}`}>
                        {calc.referencePrice != null ? (
                          <>
                            {num(calc.referencePrice, 2)} บ./ล.
                            <br />
                            <span className="text-slate-400">{calc.bandLabel}</span>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className={`num font-semibold${bad("revenue")}`}>{baht(calc.revenue)}</td>
                      <td>
                        {calc.issues.length === 0 ? (
                          <Badge tone="ok">ครบ</Badge>
                        ) : (
                          <div className="min-w-52 space-y-0.5 text-[11px] leading-relaxed text-red-700">
                            {calc.issues.map((msg, k) => (
                              <div key={k}>✕ {msg}</div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="no-print">
                        <JobRowActions id={job.id} canReturn={(legsPerTrip.get(job.tripCode) ?? 0) < 2} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8}>รวม {totals.legs} ขา</td>
                  <td className="num">{num(totals.kpi, 1)} ล.</td>
                  <td className="num">{baht(totals.allowance)}</td>
                  <td />
                  <td className="num">{baht(totals.revenue)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {totals.issues > 0 && (
        <Card title="รายละเอียดปัญหาที่พบ" className="mt-4">
          <ul className="space-y-1.5 text-[13px]">
            {[...new Set(calcs.flatMap((x) => x.calc.issues))].map((msg) => (
              <li key={msg} className="flex items-start gap-2">
                <span className="text-red-500">•</span>
                <span className="text-slate-700">{msg}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
