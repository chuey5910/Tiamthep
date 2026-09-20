"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui";
import { formatThaiDate } from "@/lib/date";
import { baht, num } from "@/lib/format";
import { exportAllowanceExcel } from "./actions";

/** ข้อมูลที่ฝั่งเซิร์ฟเวอร์ส่งมา — วันที่แปลงเป็นข้อความแล้ว เพื่อส่งข้ามไปฝั่งเบราว์เซอร์ได้ */
export type LegView = {
  jobId: number;
  sheetRef: string | null;
  date: string;
  tripCode: string;
  plate: string;
  trailerPlate: string | null;
  customer: string;
  origin: string;
  destination: string;
  vehicleType: string | null;
  weight: number;
  allowance: number;
  advance: number;
  toll: number;
  net: number;
  issues: string[];
};

export type AdvanceView = {
  id: number;
  date: string;
  plate: string | null;
  sheetRef: string | null;
  advance: number;
  toll: number;
  note: string | null;
};

export type BonusView = {
  tripCode: string;
  plate: string;
  endDate: string;
  legs: number;
  kpiLitres: number;
  usedLitres: number;
  savedLitres: number;
  rate: number;
  bonus: number;
};

export type DriverView = {
  driverCode: string;
  name: string;
  legs: number;
  allowance: number;
  advance: number;
  toll: number;
  fuelBonus: number;
  netPay: number;
  legRows: LegView[];
  looseAdvances: AdvanceView[];
  bonusRows: BonusView[];
};

type Detail =
  | { kind: "legs"; driver: DriverView }
  | { kind: "allowance"; driver: DriverView }
  | { kind: "advance"; driver: DriverView }
  | { kind: "toll"; driver: DriverView }
  | { kind: "bonus"; driver: DriverView }
  | { kind: "net"; driver: DriverView }
  | { kind: "leg"; driver: DriverView; leg: LegView };

/** แสดงยอดพร้อมเครื่องหมาย — 0 แสดงเป็นขีด ไม่ใช่ "+0" หรือ "-0" */
const signed = (n: number) => (n === 0 ? "-" : n < 0 ? `-${baht(Math.abs(n))}` : `+${baht(n)}`);

const TITLES: Record<string, string> = {
  legs: "รายละเอียดทุกขาที่วิ่งในงวด",
  allowance: "ที่มาของเบี้ยเลี้ยงรวม",
  advance: "เงินเดินทางที่รับไปก่อนออกงาน",
  toll: "ค่าทางด่วนที่สำรองจ่าย",
  bonus: "เงินพิเศษค่าน้ำมัน",
  net: "การคำนวณยอดจ่ายสุทธิ",
  leg: "รายละเอียดของขานี้",
};

export function AllowanceTable({
  rows,
  year,
  month,
  period,
  driverCode,
}: {
  rows: DriverView[];
  year: number;
  month: number;
  period: 1 | 2;
  driverCode: string;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const t = rows.reduce(
    (a, r) => ({
      legs: a.legs + r.legs,
      allowance: a.allowance + r.allowance,
      advance: a.advance + r.advance,
      toll: a.toll + r.toll,
      fuelBonus: a.fuelBonus + r.fuelBonus,
      netPay: a.netPay + r.netPay,
    }),
    { legs: 0, allowance: 0, advance: 0, toll: 0, fuelBonus: 0, netPay: 0 },
  );

  const download = () => {
    setError(null);
    start(async () => {
      const res = await exportAllowanceExcel(year, month, period, driverCode);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // แปลง base64 กลับเป็นไฟล์แล้วให้เบราว์เซอร์บันทึก
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  /** ช่องตัวเลขที่กดดูรายละเอียดได้ */
  const Cell = ({
    onClick,
    children,
    className = "",
  }: {
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
  }) => (
    <td className={`num ${className}`}>
      <button
        type="button"
        onClick={onClick}
        className="w-full cursor-pointer rounded px-1 text-right underline decoration-dotted underline-offset-2 hover:bg-brand-50"
      >
        {children}
      </button>
    </td>
  );

  return (
    <>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={download} disabled={pending}>
          {pending ? "กำลังสร้างไฟล์…" : "⬇ Export to Excel"}
        </button>
        <span className="text-[12px] text-slate-500">
          – ไฟล์มี 2 ชีต: «สรุปรายคน» และ «รายละเอียดรายขา» · กดตัวเลขในตารางเพื่อดูที่มาของยอดนั้น
        </span>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
      )}

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อ-สกุล</th>
              <th className="num">จำนวนขา</th>
              <th className="num">เบี้ยเลี้ยงรวม</th>
              <th className="num">หัก เงินเดินทางรับ</th>
              <th className="num">บวก ค่าทางด่วน</th>
              <th className="num">บวก เงินพิเศษน้ำมัน</th>
              <th className="num">จ่ายสุทธิ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.driverCode}>
                <td className="font-bold">{r.driverCode}</td>
                <td>{r.name}</td>
                <Cell onClick={() => setDetail({ kind: "legs", driver: r })}>{r.legs || "-"}</Cell>
                <Cell onClick={() => setDetail({ kind: "allowance", driver: r })}>{baht(r.allowance)}</Cell>
                <Cell onClick={() => setDetail({ kind: "advance", driver: r })} className="text-red-600">
                  {r.advance ? `-${baht(r.advance)}` : "-"}
                </Cell>
                <Cell onClick={() => setDetail({ kind: "toll", driver: r })} className="text-emerald-700">
                  {r.toll ? `+${baht(r.toll)}` : "-"}
                </Cell>
                <Cell onClick={() => setDetail({ kind: "bonus", driver: r })} className="text-emerald-700">
                  {r.fuelBonus ? `+${baht(r.fuelBonus)}` : "-"}
                </Cell>
                <Cell onClick={() => setDetail({ kind: "net", driver: r })} className="font-bold">
                  {baht(r.netPay)}
                </Cell>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>รวมทั้งงวด</td>
              <td className="num">{t.legs}</td>
              <td className="num">{baht(t.allowance)}</td>
              <td className="num">{signed(-t.advance)}</td>
              <td className="num">{signed(t.toll)}</td>
              <td className="num">{signed(t.fuelBonus)}</td>
              <td className="num">{baht(t.netPay)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ตารางรายขา — แสดงเมื่อเลือก พขร. คนเดียว จะได้ตรวจทานได้ทั้งหน้าโดยไม่ต้องเปิดทีละช่อง */}
      {rows.length === 1 && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <div className="mb-2 text-[14px] font-bold text-slate-900">
            🔸 รายละเอียดรายขา — {rows[0].driverCode} {rows[0].name}
          </div>
          <LegTable driver={rows[0]} onPick={(leg) => setDetail({ kind: "leg", driver: rows[0], leg })} />
        </div>
      )}

      {detail && (
        <Modal title={`${TITLES[detail.kind]} — ${detail.driver.driverCode} ${detail.driver.name}`} onClose={() => setDetail(null)}>
          <DetailBody detail={detail} onPickLeg={(leg) => setDetail({ kind: "leg", driver: detail.driver, leg })} />
        </Modal>
      )}
    </>
  );
}

function LegTable({ driver, onPick }: { driver: DriverView; onPick: (leg: LegView) => void }) {
  if (driver.legRows.length === 0) {
    return <p className="px-1 py-3 text-[13px] text-slate-500">ไม่มีขาที่วิ่งในงวดนี้</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>วันที่</th>
            <th>ทะเบียน</th>
            <th>ลูกค้า</th>
            <th>ต้นทาง → ปลายทาง</th>
            <th className="num">น้ำหนัก (ตัน)</th>
            <th className="num">เบี้ยเลี้ยง</th>
            <th className="num">หัก เงินเดินทาง</th>
            <th className="num">บวก ทางด่วน</th>
            <th className="num">สุทธิของขา</th>
            <th className="no-print"></th>
          </tr>
        </thead>
        <tbody>
          {driver.legRows.map((l) => (
            <tr key={l.jobId} className={l.issues.length ? "bg-amber-50" : undefined}>
              <td className="whitespace-nowrap">{l.date}</td>
              <td className="whitespace-nowrap">{l.plate}</td>
              <td>{l.customer}</td>
              <td className="whitespace-nowrap">
                {l.origin} → {l.destination}
              </td>
              <td className="num">{l.weight ? num(l.weight, 3) : "-"}</td>
              <td className="num">{baht(l.allowance)}</td>
              <td className="num text-red-600">{l.advance ? `-${baht(l.advance)}` : "-"}</td>
              <td className="num text-emerald-700">{l.toll ? `+${baht(l.toll)}` : "-"}</td>
              <td className="num font-bold">{baht(l.net)}</td>
              <td className="no-print">
                <button type="button" className="btn btn-ghost px-2 py-1 text-[12px]" onClick={() => onPick(l)}>
                  ดูรายละเอียด
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>รวม {driver.legRows.length} ขา</td>
            <td className="num">{baht(driver.legRows.reduce((a, l) => a + l.allowance, 0))}</td>
            <td className="num">{signed(-driver.legRows.reduce((a, l) => a + l.advance, 0))}</td>
            <td className="num">{signed(driver.legRows.reduce((a, l) => a + l.toll, 0))}</td>
            <td className="num">{baht(driver.legRows.reduce((a, l) => a + l.net, 0))}</td>
            <td className="no-print" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DetailBody({ detail, onPickLeg }: { detail: Detail; onPickLeg: (leg: LegView) => void }) {
  const d = detail.driver;

  if (detail.kind === "leg") {
    const l = detail.leg;
    const lines: [string, string][] = [
      ["วันที่", l.date],
      ["รหัสงานในชีต", l.sheetRef ?? "— (บันทึกในเว็บ)"],
      ["รหัสรอบ", l.tripCode],
      ["ทะเบียน", l.trailerPlate ? `${l.plate} + ${l.trailerPlate}` : l.plate],
      ["ประเภทรถ", l.vehicleType ?? "-"],
      ["ลูกค้า", l.customer],
      ["ต้นทาง → ปลายทาง", `${l.origin} → ${l.destination}`],
      ["น้ำหนักที่ใช้คิดเงิน", l.weight ? `${num(l.weight, 3)} ตัน` : "-"],
      ["เบี้ยเลี้ยงตามเส้นทาง", baht(l.allowance)],
      ["หัก เงินเดินทางที่รับไป", l.advance ? `-${baht(l.advance)}` : "-"],
      ["บวก ค่าทางด่วนที่สำรองจ่าย", l.toll ? `+${baht(l.toll)}` : "-"],
      ["เบี้ยเลี้ยงสุทธิของขานี้", baht(l.net)],
    ];
    return (
      <>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {lines.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-dashed border-[var(--border)] py-1">
              <dt className="text-[13px] text-slate-600">{k}</dt>
              <dd className="text-[13px] font-bold text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
        {l.issues.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            <b>ข้อมูลขานี้ยังไม่ครบ</b>
            <ul className="mt-1 space-y-0.5">
              {l.issues.map((m, i) => (
                <li key={i}>– {m}</li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  if (detail.kind === "advance" || detail.kind === "toll") {
    const isAdvance = detail.kind === "advance";
    const legs = d.legRows.filter((l) => (isAdvance ? l.advance : l.toll) !== 0);
    const loose = d.looseAdvances.filter((a) => (isAdvance ? a.advance : a.toll) !== 0);
    if (legs.length === 0 && loose.length === 0) {
      return <p className="text-[13px] text-slate-500">ไม่มีรายการในงวดนี้</p>;
    }
    return (
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>รหัสงานในชีต</th>
              <th>ทะเบียน</th>
              <th>เส้นทาง / หมายเหตุ</th>
              <th className="num">{isAdvance ? "เงินเดินทาง" : "ค่าทางด่วน"}</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((l) => (
              <tr key={`j${l.jobId}`}>
                <td className="whitespace-nowrap">{l.date}</td>
                <td>{l.sheetRef ?? "-"}</td>
                <td>{l.plate}</td>
                <td>
                  {l.origin} → {l.destination}
                </td>
                <td className={`num font-bold ${isAdvance ? "text-red-600" : "text-emerald-700"}`}>
                  {isAdvance ? `-${baht(l.advance)}` : `+${baht(l.toll)}`}
                </td>
              </tr>
            ))}
            {loose.map((a) => (
              <tr key={`a${a.id}`} className="bg-amber-50">
                <td className="whitespace-nowrap">{a.date}</td>
                <td>{a.sheetRef ?? "-"}</td>
                <td>{a.plate ?? "-"}</td>
                <td>
                  {a.note ?? "-"} <Badge tone="warn">ไม่ผูกกับขาในงวด</Badge>
                </td>
                <td className={`num font-bold ${isAdvance ? "text-red-600" : "text-emerald-700"}`}>
                  {isAdvance ? `-${baht(a.advance)}` : `+${baht(a.toll)}`}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>รวม</td>
              <td className="num">{isAdvance ? `-${baht(d.advance)}` : `+${baht(d.toll)}`}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (detail.kind === "bonus") {
    if (d.bonusRows.length === 0) return <p className="text-[13px] text-slate-500">ไม่มีเงินพิเศษค่าน้ำมันในงวดนี้</p>;
    return (
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>วันจบรอบ</th>
              <th>รหัสรอบ</th>
              <th>ทะเบียน</th>
              <th className="num">ขา</th>
              <th className="num">เป้าหมาย (ล.)</th>
              <th className="num">เติมจริง (ล.)</th>
              <th className="num">ประหยัด (ล.)</th>
              <th className="num">เรต</th>
              <th className="num">เงินพิเศษ</th>
            </tr>
          </thead>
          <tbody>
            {d.bonusRows.map((b) => (
              <tr key={b.tripCode}>
                <td className="whitespace-nowrap">{b.endDate}</td>
                <td>{b.tripCode}</td>
                <td>{b.plate}</td>
                <td className="num">{b.legs}</td>
                <td className="num">{num(b.kpiLitres, 1)}</td>
                <td className="num">{num(b.usedLitres, 1)}</td>
                <td className={`num ${b.savedLitres < 0 ? "text-red-600" : ""}`}>{num(b.savedLitres, 1)}</td>
                <td className="num">{baht(b.rate)}</td>
                <td className="num font-bold text-emerald-700">{baht(b.bonus)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={8}>รวม</td>
              <td className="num">{baht(d.fuelBonus)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (detail.kind === "net") {
    const lines: [string, string][] = [
      [`เบี้ยเลี้ยงรวม (${d.legs} ขา)`, baht(d.allowance)],
      ["หัก เงินเดินทางที่รับไปแล้ว", `-${baht(d.advance)}`],
      ["บวก ค่าทางด่วนที่สำรองจ่าย", `+${baht(d.toll)}`],
      ["บวก เงินพิเศษค่าน้ำมัน", `+${baht(d.fuelBonus)}`],
    ];
    return (
      <>
        <dl>
          {lines.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-dashed border-[var(--border)] py-1.5">
              <dt className="text-[13px] text-slate-600">{k}</dt>
              <dd className="text-[13px] font-bold text-slate-900">{v}</dd>
            </div>
          ))}
          <div className="mt-2 flex justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2">
            <dt className="text-[14px] font-bold text-brand-900">ยอดจ่ายสุทธิ</dt>
            <dd className="text-[16px] font-extrabold text-brand-900">{baht(d.netPay)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-slate-500">– กดที่ยอดแต่ละช่องในตารางหลัก เพื่อดูรายการที่ประกอบเป็นยอดนั้น</p>
      </>
    );
  }

  // legs / allowance — ตารางรายขาเหมือนกัน
  return <LegTable driver={d} onPick={onPickLeg} />;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-5xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
          <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={onClose}>
            ✕ ปิด
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
