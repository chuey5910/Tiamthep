import Link from "next/link";
import { DateRangeFilter, SearchFilter, SelectFilter } from "@/components/Filters";
import { Badge, Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { formatThaiDate, toInputDate } from "@/lib/date";
import { baht, num } from "@/lib/format";
import { readRange, type SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";
import { buildContext, computeJob, resolveDriver } from "@/lib/calc";
import { sortOptionsThaiFirst } from "@/lib/sort";
import { JobForm, JobRowActions, type JobInitial } from "./JobForm";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = readRange(sp);
  const editId = typeof sp.edit === "string" ? Number(sp.edit) : null;
  // ?problems=1 = แสดงเฉพาะขาที่ข้อมูลยังไม่ครบ (เหมือนหน้านำเข้าน้ำมัน)
  const onlyProblems = sp.problems === "1";
  // ตัวกรองเพิ่ม: ค้นข้อความ (ทะเบียน/รอบ/เส้นทาง/พขร./หมายเหตุ) · ลูกค้า · ทะเบียน
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const customerFilter = typeof sp.customer === "string" ? sp.customer : "";
  const plateFilter = typeof sp.plate === "string" ? sp.plate.trim() : "";
  const fold = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/\s+/g, "");

  const [vehiclesRaw, customers, locations, cargoTypes, drivers, jobs, ctx] = await Promise.all([
    prisma.vehicle.findMany({ where: { active: true }, orderBy: { plate: "asc" } }),
    prisma.customer.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.lookup.findMany({ where: { kind: "location" }, orderBy: [{ sort: "asc" }, { value: "asc" }] }),
    prisma.lookup.findMany({ where: { kind: "cargoType" }, orderBy: { sort: "asc" } }),
    prisma.driver.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.job.findMany({
      where: { loadDate: { gte: from, lte: to } },
      orderBy: [{ loadDate: "desc" }, { tripCode: "asc" }, { id: "asc" }],
      take: 500,
    }),
    buildContext(),
  ]);

  const editing = editId ? await prisma.job.findUnique({ where: { id: editId } }) : null;
  // งานที่วางบิลไปแล้ว — แก้แล้วยอดในใบไม่เปลี่ยนเอง ต้องบอกว่าไปกดปรับยอดที่ไหน
  const editingInvoice = editing
    ? await prisma.customerBillingLine.findUnique({
        where: { jobId: editing.id },
        select: { billing: { select: { invoiceNo: true, billedAt: true, customerId: true } } },
      })
    : null;

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const allCalcs = jobs.map((j) => ({ job: j, calc: computeJob(ctx, j) }));

  // กรองตามลูกค้า / ทะเบียน / คำค้น — ยอดรวมด้านบนคิดจากชุดที่กรองแล้ว
  // จะได้เอาไปเทียบกับรายงานรายได้แยกตามลูกค้าได้ตรงๆ
  const fq = fold(q);
  const calcs = allCalcs.filter(({ job, calc }) => {
    if (customerFilter && String(job.customerId) !== customerFilter) return false;
    if (plateFilter && job.headPlate !== plateFilter && job.trailerPlate !== plateFilter) return false;
    if (fq) {
      const hay = [job.sheetRef, job.headPlate, job.trailerPlate, job.tripCode, job.origin, job.destination, job.note, calc.driverCode, customerById.get(job.customerId)?.code, customerById.get(job.customerId)?.name];
      if (!hay.some((v) => fold(v).includes(fq))) return false;
    }
    return true;
  });
  const shown = onlyProblems ? calcs.filter((x) => x.calc.issues.length > 0) : calcs;
  const filtering = !!(q || customerFilter || plateFilter);

  // พิมพ์รหัสงานในชีต (เช่น TT690908-31) แต่ไม่เจอในช่วงวันที่นี้ — หาให้ทั้งฐานข้อมูล
  // แล้วบอกว่าอยู่วันไหน พร้อมลิงก์กระโดดไป ไม่ต้องไล่เปลี่ยนเดือนเอง
  const looksLikeSheetRef = /^TT\d{6}-\d+$/i.test(q);
  const elsewhere =
    looksLikeSheetRef && calcs.length === 0
      ? await prisma.job.findUnique({ where: { sheetRef: q.toUpperCase() }, select: { id: true, loadDate: true, headPlate: true, origin: true, destination: true } })
      : null;

  const totals = {
    legs: calcs.length,
    revenue: calcs.reduce((a, x) => a + x.calc.revenue, 0),
    allowance: calcs.reduce((a, x) => a + x.calc.allowance, 0),
    kpi: calcs.reduce((a, x) => a + (x.calc.kpiLitres ?? 0), 0),
    issues: calcs.filter((x) => x.calc.issues.length > 0).length,
  };

  // ลิงก์สลับ ทุกขา/เฉพาะที่ต้องแก้ ต้องพาตัวกรองอื่นติดไปด้วย
  const keep = new URLSearchParams({ from: fromStr, to: toStr });
  if (q) keep.set("q", q);
  if (customerFilter) keep.set("customer", customerFilter);
  if (plateFilter) keep.set("plate", plateFilter);
  const baseQs = keep.toString();

  // ขาที่ยังไม่มีคู่ในรอบเดียวกัน — เสนอปุ่มสร้างขากลับให้
  const legsPerTrip = new Map<string, number>();
  for (const j of jobs) legsPerTrip.set(j.tripCode, (legsPerTrip.get(j.tripCode) ?? 0) + 1);

  // พขร. ของงานที่กำลังแก้ มาจากไหน — บอกให้ชัด จะได้รู้ว่าต้องเลือกเองไหม
  // (รถสแปร์ไม่มีคู่ประจำ ถ้าปล่อยเป็นอัตโนมัติ ระบบจะหาไม่เจอแล้วขึ้น «ไม่พบ»)
  const driverStatus = (() => {
    if (!editing) return "";
    if (editing.driverCode) {
      return editing.sheetRef ? `✅ ใช้ ${editing.driverCode} ตามที่ระบุในชีต` : `✅ ใช้ ${editing.driverCode} ตามที่บันทึกไว้`;
    }
    const auto = resolveDriver(ctx.pairings, editing.headPlate, editing.trailerPlate, editing.loadDate);
    if (auto) return `✅ ระบบหาให้จากตารางจับคู่รถ: ${auto}`;
    const vehicle = ctx.vehicleByPlate.get(editing.headPlate);
    if (vehicle?.ownerType === "รถร่วม") return "รถร่วม — ไม่มี พขร. ของบริษัท";
    return "❌ ไม่พบในตารางจับคู่รถ — รถคันนี้ไม่มีคู่ประจำ ให้เลือก พขร. ที่ช่องนี้";
  })();

  const initial: JobInitial | undefined = editing
    ? {
        id: editing.id,
        loadDate: toInputDate(editing.loadDate),
        unloadDate: toInputDate(editing.unloadDate),
        tripCode: editing.tripCode,
        headPlate: editing.headPlate,
        trailerPlate: editing.trailerPlate ?? "",
        driverCode: editing.driverCode ?? "",
        driverStatus,
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

  // รายการต้นทาง/ปลายทาง/ประเภทสินค้า = รายการตัวเลือก + ชื่อที่งานในช่วงนี้ใช้อยู่จริง
  // งานที่ดึงมาจากชีตมักใช้ชื่อที่ยังไม่ได้เพิ่มในรายการตัวเลือก ถ้าไม่รวมเข้ามา
  // ช่องจะว่างตอนกดแก้ไข แล้วข้อมูลเดิมหายโดยไม่มีใครรู้
  const union = (master: string[], used: string[]) =>
    sortOptionsThaiFirst([...new Set([...master, ...used.filter(Boolean)])].map((v) => opt(v, v)));
  const locationOptions = union(
    locations.map((l) => l.value),
    jobs.flatMap((j) => [j.origin, j.destination]),
  );
  const cargoOptions = union(
    cargoTypes.map((c) => c.value),
    jobs.map((j) => j.cargoType ?? ""),
  );

  return (
    <>
      <PageHeader
        title="บันทึกงานขนส่ง"
        subtitle="1 แถว = 1 ขา — กรอกแค่ทะเบียนกับเส้นทาง ระบบหา พขร. ระยะทาง เบี้ยเลี้ยง และค่าบรรทุกให้เอง"
      />

      <Formula>
        <b>พขร. ปกติไม่ต้องเลือก</b> — ระบบดึงจากตารางจับคู่รถ ณ วันที่ทำงาน · ยกเว้น<b>รถสแปร์ที่ไม่มีคู่ประจำ</b> ให้เลือกเองในช่อง พขร.
        (งานจากชีตใช้รหัสคนขับตามชีต) · <b>ไม่ต้องกรอกราคา</b> — ระบบหาจากตารางเส้นทาง
        เทียบกับช่วงราคาน้ำมันตามเกณฑ์ของลูกค้ารายนั้น · ถ้าคอลัมน์ &laquo;สถานะ&raquo; ขึ้นเตือน แปลว่ายังตั้งข้อมูลไม่ครบ
        ตัวเลขในรายงานจะยังไม่ถูก
      </Formula>

      <Card title={editing ? `แก้ไขงาน #${editing.id}` : "บันทึกงานใหม่"} className="mb-4 no-print">
        {editingInvoice && (
          <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            ⚠️ งานนี้วางบิลไปแล้วในใบ <b>{editingInvoice.billing.invoiceNo}</b> — แก้น้ำหนักแล้ว ยอดในใบไม่เปลี่ยนเอง
            ให้ไปกด{" "}
            <a
              className="font-bold underline"
              href={`/reports/billing-history?year=${editingInvoice.billing.billedAt.getUTCFullYear()}&month=${editingInvoice.billing.billedAt.getUTCMonth() + 1}&customer=${editingInvoice.billing.customerId}`}
              target="_blank"
              rel="noopener"
            >
              «🔄 ปรับยอดใบนี้» ที่หน้ารายงานการวางบิล ↗
            </a>
          </p>
        )}
        <JobForm
          vehicles={vehiclesRaw
            .filter((v) => !v.vehicleType.includes("หาง"))
            .map((v) => opt(v.plate, `${v.plate} (${v.vehicleType})`))}
          trailers={vehiclesRaw
            .filter((v) => v.vehicleType.includes("หาง"))
            .map((v) => opt(v.plate, `${v.plate} (${v.vehicleType})`))}
          customers={customers.map((c) => opt(String(c.id), `${c.code} — ${c.name}`))}
          locations={locationOptions}
          cargoTypes={cargoOptions}
          drivers={drivers.map((d) => opt(d.code, `${d.code} — ${d.firstName} ${d.lastName}`))}
          initial={initial}
        />
      </Card>

      <DateRangeFilter from={fromStr} to={toStr} />

      <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
        <SearchFilter value={q} placeholder="รหัสงานในชีต ทะเบียน รอบ เส้นทาง พขร. หมายเหตุ…" />
        <SelectFilter
          name="customer"
          label="ลูกค้า"
          value={customerFilter}
          width="w-64"
          options={[{ value: "", label: "— ทุกลูกค้า —" }, ...customers.map((c) => opt(String(c.id), `${c.code} — ${c.name}`))]}
        />
        <SelectFilter
          name="plate"
          label="ทะเบียน"
          value={plateFilter}
          width="w-44"
          options={[{ value: "", label: "— ทุกคัน —" }, ...vehiclesRaw.map((v) => opt(v.plate, v.plate))]}
        />
        <span className="pb-2 text-[12px] text-slate-500">
          {filtering ? `พบ ${calcs.length} จาก ${allCalcs.length} ขาในช่วงนี้` : `${allCalcs.length} ขาในช่วงนี้`}
        </span>
      </div>

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
          href={`?${baseQs}`}
          className={`btn px-3 py-1 text-[12px] ${onlyProblems ? "btn-ghost" : "btn-primary"}`}
        >
          ทุกขา ({calcs.length})
        </Link>
        <Link
          href={`?${baseQs}&problems=1`}
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

      {elsewhere && (
        <p className="no-print mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-900">
          ⚠️ รหัส <b className="font-mono">{q.toUpperCase()}</b> มีในเว็บ แต่อยู่นอกช่วงวันที่ที่เลือก — วันที่ {formatThaiDate(elsewhere.loadDate)} ·{" "}
          {elsewhere.headPlate} · {elsewhere.origin} → {elsewhere.destination}{" "}
          <Link
            className="font-bold underline"
            href={`?from=${toInputDate(elsewhere.loadDate)}&to=${toInputDate(elsewhere.loadDate)}&q=${encodeURIComponent(q)}`}
          >
            ไปดูงานนี้ →
          </Link>
        </p>
      )}

      <Card bodyClass="p-0">
        {shown.length === 0 ? (
          <Empty>{onlyProblems ? "ไม่มีขาที่ต้องแก้ในช่วงนี้ — ข้อมูลครบทุกขา" : filtering ? "ไม่พบงานตามเงื่อนไขที่กรองในช่วงวันที่นี้" : "ยังไม่มีงานในช่วงวันที่นี้"}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>รหัสรอบ</th>
                  <th>ทะเบียน</th>
                  <th>พขร.</th>
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
                      <td className="font-mono text-[11px] text-slate-500">
                        {job.tripCode}
                        {/* รหัสงานในชีต — ให้ค้นเจอแล้วเห็นเลยว่าใช่แถวนั้น */}
                        {job.sheetRef && <div className="text-[10px] text-slate-400">ชีต {job.sheetRef}</div>}
                      </td>
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
                      <td className={`num font-semibold${bad("revenue")}`}>
                        {baht(calc.revenue)}
                        {calc.customerRate != null && (
                          <div className="whitespace-nowrap text-[10px] font-normal text-slate-400">
                            {calc.priceUnit === "ต่อกิโลกรัม"
                              ? `${num(calc.customerRate, 3)} × ${num(calc.billingWeight * 1000, 0)} กก.`
                              : calc.priceUnit === "ต่อตัน"
                                ? `${num(calc.customerRate, 2)} × ${num(calc.billingWeight, 3)} ตัน`
                                : `${num(calc.customerRate, 2)} ${calc.priceUnit}`}
                          </div>
                        )}
                      </td>
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
