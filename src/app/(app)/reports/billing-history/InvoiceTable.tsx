"use client";

import { useState } from "react";
import { Badge } from "@/components/ui";
import { money } from "@/lib/format";

export type InvoiceRow = {
  id: number;
  invoiceNo: string;
  customerId: number;
  customerCode: string;
  customerName: string;
  billedAt: string;
  dueAt: string;
  /** วันที่เหลือจนถึงกำหนดชำระ (ติดลบ = เลยกำหนดแล้ว) */
  daysLeft: number | null;
  period: string;
  periodFrom: string;
  periodTo: string;
  legs: number;
  amount: number;
  vatRate: number;
  vatAmount: number;
  whtRate: number;
  whtAmount: number;
  netAmount: number;
  billedBy: string | null;
};

/** สถานะกำหนดชำระ — ยังไม่ถึงกำหนด / ใกล้ครบ / เลยกำหนดแล้ว */
function DueBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft == null) return <Badge tone="muted">ไม่ได้ตั้งเครดิต</Badge>;
  if (daysLeft < 0) return <Badge tone="error">เลยกำหนด {Math.abs(daysLeft)} วัน</Badge>;
  if (daysLeft <= 7) return <Badge tone="warn">อีก {daysLeft} วัน</Badge>;
  return <Badge tone="ok">อีก {daysLeft} วัน</Badge>;
}

export function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  const [open, setOpen] = useState<InvoiceRow | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>เลขที่ใบวางบิล</th>
              <th>บริษัท</th>
              <th>วันที่วางบิล</th>
              <th>ช่วงงาน</th>
              <th className="num">ขา</th>
              <th className="num">ค่าบรรทุก</th>
              <th className="num">VAT</th>
              <th className="num">หัก ณ ที่จ่าย</th>
              <th className="num">ยอดรับสุทธิ</th>
              <th>ครบกำหนดชำระ</th>
              <th>ผู้บันทึก</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.daysLeft != null && r.daysLeft < 0 ? "bg-red-50" : undefined}>
                <td className="whitespace-nowrap font-bold">{r.invoiceNo}</td>
                <td className="whitespace-nowrap">
                  <b>{r.customerCode}</b> <span className="text-slate-600">{r.customerName}</span>
                </td>
                <td className="whitespace-nowrap">{r.billedAt}</td>
                <td className="whitespace-nowrap text-slate-600">{r.period}</td>
                <td className="num">{r.legs}</td>
                <td className="num">{money(r.amount)}</td>
                <td className="num text-slate-600">{r.vatAmount ? money(r.vatAmount) : "-"}</td>
                <td className="num text-red-600">{r.whtAmount ? `-${money(r.whtAmount)}` : "-"}</td>
                <td className="num font-bold">{money(r.netAmount)}</td>
                <td className="whitespace-nowrap">
                  {r.dueAt || "-"} <DueBadge daysLeft={r.daysLeft} />
                </td>
                <td className="text-slate-600">{r.billedBy ?? "-"}</td>
                <td className="no-print whitespace-nowrap">
                  <button type="button" className="btn btn-ghost px-2 py-1 text-[12px]" onClick={() => setOpen(r)}>
                    ดูยอด
                  </button>{" "}
                  <a
                    href={`/reports/billing?from=${r.periodFrom}&to=${r.periodTo}&customer=${r.customerId}`}
                    target="_blank"
                    rel="noopener"
                    className="btn btn-ghost px-2 py-1 text-[12px]"
                    title="เปิดหน้าวางบิลของลูกค้ารายนี้ ช่วงงานเดียวกับใบนี้ (แท็บใหม่)"
                  >
                    ดูรายการขา ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6"
          onClick={() => setOpen(null)}
        >
          <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
              <h2 className="text-[15px] font-bold text-slate-900">
                {open.invoiceNo} — {open.customerCode} {open.customerName}
              </h2>
              <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => setOpen(null)}>
                ✕ ปิด
              </button>
            </header>
            <div className="p-4">
              <dl className="text-[14px]">
                <Line label="วันที่วางบิล" value={open.billedAt} />
                <Line label="ช่วงงานที่เรียกเก็บ" value={open.period} />
                <Line label="จำนวนขา" value={`${open.legs} ขา`} />
                <Line label="ผู้บันทึก" value={open.billedBy ?? "-"} />
                <div className="my-2 border-t border-[var(--border)]" />
                <Line label="ค่าบรรทุกรวม" value={money(open.amount)} />
                <Line label={`ภาษีมูลค่าเพิ่ม ${open.vatRate}%`} value={money(open.vatAmount)} />
                <Line label="รวมทั้งสิ้น" value={money(open.amount + open.vatAmount)} bold />
                <Line label={`หัก ภาษี ณ ที่จ่าย ${open.whtRate}%`} value={`-${money(open.whtAmount)}`} red />
                <div className="mt-2 flex justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2">
                  <dt className="text-[14px] font-bold text-brand-900">ยอดรับสุทธิ</dt>
                  <dd className="text-[16px] font-extrabold text-brand-900">{money(open.netAmount)}</dd>
                </div>
                <div className="mt-3 flex justify-between gap-3">
                  <dt className="text-[13px] text-slate-600">ครบกำหนดชำระ</dt>
                  <dd className="text-[13px] font-bold text-slate-900">
                    {open.dueAt || "-"} <DueBadge daysLeft={open.daysLeft} />
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-[12px] text-slate-500">
                – ยอดนี้คือยอด ณ วันที่กดออกบิล เก็บไว้เทียบย้อนหลัง ถึงข้อมูลงานจะถูกแก้ทีหลังก็ไม่เปลี่ยน
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Line({ label, value, bold, red }: { label: string; value: string; bold?: boolean; red?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-[var(--border)] py-1.5">
      <dt className={`text-[13px] ${bold ? "font-bold text-slate-900" : "text-slate-600"}`}>{label}</dt>
      <dd className={`text-[13px] font-bold ${red ? "text-red-600" : "text-slate-900"}`}>{value}</dd>
    </div>
  );
}
