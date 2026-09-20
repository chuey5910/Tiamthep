import { MonthFilter, SelectFilter } from "@/components/Filters";
import { Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { TH_MONTHS_FULL, formatThaiDate, payPeriod } from "@/lib/date";
import { baht } from "@/lib/format";
import { readInt, readMonth, type SearchParams } from "@/lib/params";
import { allowanceDetail, loadPeriod } from "@/lib/reports";
import { AllowanceTable, type DriverView } from "./AllowanceTable";

export const dynamic = "force-dynamic";

export default async function AllowancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { year, month } = readMonth(sp);
  const period = (readInt(sp, "period", 1) === 2 ? 2 : 1) as 1 | 2;
  const driverCode = typeof sp.driver === "string" ? sp.driver.trim() : "";
  const { from, to } = payPeriod(year, month, period);

  const data = await loadPeriod({ from, to });
  const all = allowanceDetail(data);
  const rows = driverCode ? all.filter((r) => r.driverCode === driverCode) : all;

  // วันที่ต้องแปลงเป็นข้อความก่อนส่งให้ฝั่งเบราว์เซอร์ (ตารางรายละเอียดเป็น client component)
  const views: DriverView[] = rows.map((r) => ({
    driverCode: r.driverCode,
    name: r.name,
    legs: r.legs,
    allowance: r.allowance,
    advance: r.advance,
    toll: r.toll,
    fuelBonus: r.fuelBonus,
    netPay: r.netPay,
    legRows: r.legRows.map((l) => ({
      jobId: l.jobId,
      sheetRef: l.sheetRef,
      date: formatThaiDate(l.date),
      tripCode: l.tripCode,
      plate: l.plate,
      trailerPlate: l.trailerPlate,
      customer: l.customer,
      origin: l.origin,
      destination: l.destination,
      vehicleType: l.vehicleType,
      weight: l.weight,
      allowance: l.allowance,
      advance: l.advance,
      toll: l.toll,
      net: l.net,
      issues: l.issues,
    })),
    looseAdvances: r.looseAdvances.map((a) => ({
      id: a.id,
      date: formatThaiDate(a.date),
      plate: a.plate,
      sheetRef: a.sheetRef,
      advance: a.advance,
      toll: a.toll,
      note: a.note,
    })),
    bonusRows: r.bonusRows.map((b) => ({
      tripCode: b.tripCode,
      plate: b.plate,
      endDate: formatThaiDate(b.endDate),
      legs: b.legs,
      kpiLitres: b.kpiLitres,
      usedLitres: b.usedLitres,
      savedLitres: b.savedLitres,
      rate: b.rate,
      bonus: b.bonus,
    })),
  }));

  const t = rows.reduce(
    (a, r) => ({
      legs: a.legs + r.legs,
      advance: a.advance + r.advance,
      netPay: a.netPay + r.netPay,
    }),
    { legs: 0, advance: 0, netPay: 0 },
  );

  // ตัวเลือกคนขับ = ทุกคนที่มียอดในงวดนี้ (ไม่ใช่ทั้งฐานข้อมูล จะได้ไม่มีตัวเลือกที่เลือกแล้วว่าง)
  const driverOptions = [
    { value: "", label: "— ทุกคน —" },
    ...all.map((r) => ({ value: r.driverCode, label: `${r.driverCode} ${r.name}` })),
  ];

  return (
    <>
      <PageHeader
        title="สรุปเบี้ยเลี้ยงพนักงานขับรถ"
        subtitle={`งวดวันที่ ${formatThaiDate(from)} ถึง ${formatThaiDate(to)} — ยอดนี้คือเงินที่ต้องจ่ายพร้อมเงินเดือน`}
      />

      <MonthFilter
        year={year}
        month={month}
        extra={
          <>
            <SelectFilter
              name="period"
              label="งวด"
              value={String(period)}
              width="w-52"
              options={[
                { value: "1", label: "งวดที่ 1 (วันที่ 1-15)" },
                { value: "2", label: "งวดที่ 2 (วันที่ 16-สิ้นเดือน)" },
              ]}
            />
            <SelectFilter
              name="driver"
              label="พนักงานขับรถ"
              value={driverCode}
              width="w-64"
              options={driverOptions}
            />
          </>
        }
      />

      <Formula>
        <b>ต่อ 1 ขา:</b> เบี้ยเลี้ยงที่ได้จริง = เบี้ยเลี้ยงตามเส้นทาง − เงินเดินทางที่รับไปก่อนออกงาน +
        ค่าทางด่วนที่สำรองจ่าย
        <br />
        <b>ทั้งงวด:</b> ยอดจ่ายสุทธิ = ผลรวมข้างต้นของทุกขา + เงินพิเศษค่าน้ำมันที่ประหยัดได้
        <br />
        <span className="opacity-80">
          ตัวอย่าง: เบี้ยเลี้ยง 1,000 − เงินเดินทาง 500 + ทางด่วน 250 = 750 บาท/ขา · วิ่ง 10 ขา = 7,500 บาท
        </span>
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="พขร. ที่ต้องจ่าย" value={rows.filter((r) => r.netPay !== 0).length} hint="คน" />
        <Stat label="รวมขาที่วิ่ง" value={t.legs} hint="ขา" />
        <Stat label="เงินเดินทางที่จ่ายไปแล้ว" value={baht(t.advance)} hint="บาท" />
        <Stat label="ยอดจ่ายสุทธิรวม" value={baht(t.netPay)} hint="บาท" tone="good" />
      </div>

      <Card
        title={`งวดที่ ${period} — ${TH_MONTHS_FULL[month - 1]} ${year + 543}${driverCode ? ` · เฉพาะ ${driverCode}` : ""}`}
      >
        {views.length === 0 ? (
          <Empty>
            {driverCode ? "พขร. คนนี้ไม่มีงานหรือรายการเงินเดินทางในงวดนี้" : "ยังไม่มีงานหรือรายการเงินเดินทางในงวดนี้"}
          </Empty>
        ) : (
          <AllowanceTable rows={views} year={year} month={month} period={period} driverCode={driverCode} />
        )}
      </Card>
    </>
  );
}
