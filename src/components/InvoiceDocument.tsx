/**
 * หน้าตาใบวางบิล 1 ใบ — ใช้ทำ PDF (src/app/print/...) ให้ออกมาเหมือนกันทุกครั้ง
 *
 * กระดาษ A4 แนวตั้ง ขอบตามระเบียบงานสารบรรณ (บน 2.5 · ล่าง 2 · ซ้าย-ขวา 2 ซม.)
 * ขอบบน/ล่างซ้ำทุกหน้าด้วยโครง .print-sheet เหมือนหน้าอื่นของเว็บ (ดู globals.css)
 * โลโก้ใช้ไฟล์ตัวจริงผ่าน <Logo /> เท่านั้น — ห้ามแก้ไขโลโก้
 */

import { Logo } from "@/components/Logo";
import type { InvoiceDoc } from "@/lib/invoice-doc";
import { money, num } from "@/lib/format";

export function InvoiceDocument({ doc }: { doc: InvoiceDoc }) {
  const c = doc.customer;
  return (
    <table className="print-sheet invoice-doc">
      <thead>
        <tr>
          <td className="print-sheet-top" />
        </tr>
      </thead>
      <tfoot>
        <tr>
          <td className="print-sheet-bottom" />
        </tr>
      </tfoot>
      <tbody>
        <tr>
          <td className="print-sheet-body">
            {/* หัวกระดาษ — โลโก้ตัวจริง + ชื่อบริษัท */}
            <div className="mb-4 flex items-end justify-between gap-4 border-b-2 border-[#111114] pb-2">
              <Logo className="w-52" title={doc.companyName} />
              <div className="text-right text-[11px] leading-relaxed text-slate-600">
                <div className="font-semibold text-slate-900">{doc.companyName}</div>
                <div>ระบบบริหารงานขนส่ง</div>
              </div>
            </div>

            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <div className="text-[15px] font-bold">
                  ใบวางบิล — {c.code} {c.name}
                </div>
                <div className="text-[12px] leading-relaxed">
                  {c.address && (
                    <>
                      ที่อยู่: {c.address}
                      <br />
                    </>
                  )}
                  เลขประจำตัวผู้เสียภาษี: {c.taxId ?? "-"} · สาขา: {c.branch ?? "-"} · เครดิต {c.creditDays} วัน
                  <br />
                  งานช่วง {doc.period} · รวม {doc.rows.length} ขา · คิดเงินตาม{c.weightBasis}
                </div>
              </div>
              {/* เลขที่/วันที่ของใบจริง — ร่างยังไม่มีเลขที่ */}
              <div className="shrink-0 text-right text-[12px] leading-relaxed">
                {doc.invoiceNo ? (
                  <>
                    <div className="text-[13px] font-bold">เลขที่ {doc.invoiceNo}</div>
                    <div>วันที่วางบิล {doc.billedAt}</div>
                    {doc.dueAt && <div>ครบกำหนดชำระ {doc.dueAt}</div>}
                  </>
                ) : (
                  <div className="text-slate-500">ร่าง — ยังไม่ออกเลขที่</div>
                )}
              </div>
            </div>

            <table className="tbl">
              <thead>
                <tr>
                  <th>ลำดับ</th>
                  <th>วันที่</th>
                  <th>ทะเบียนรถ</th>
                  <th>เลขที่ตั๋วต้นทาง</th>
                  <th>ต้นทาง</th>
                  <th>ปลายทาง</th>
                  <th className="num">น้ำหนักต้นทาง</th>
                  <th className="num">น้ำหนักปลายทาง</th>
                  <th className="num">ราคา/หน่วย</th>
                  <th className="num">ค่าบรรทุก (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {doc.rows.map((r) => (
                  <tr key={r.seq}>
                    <td>{r.seq}</td>
                    <td className="whitespace-nowrap">{r.date}</td>
                    <td className="whitespace-nowrap">{r.plate}</td>
                    <td className="whitespace-nowrap">{r.ticket}</td>
                    <td>{r.origin}</td>
                    <td>{r.destination}</td>
                    <td className="num">{r.weightOrigin != null ? num(r.weightOrigin, 3) : "-"}</td>
                    <td className="num">{r.weightDest != null ? num(r.weightDest, 3) : "-"}</td>
                    <td className="num">{r.rate}</td>
                    <td className="num">{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>รวม {doc.rows.length} ขา</td>
                  <td className="num">{num(doc.sumWeightOrigin, 3)}</td>
                  <td className="num">{num(doc.sumWeightDest, 3)}</td>
                  <td className="num">—</td>
                  <td className="num">{money(doc.amount)}</td>
                </tr>
              </tfoot>
            </table>

            {/* ท้ายบิลบรรทัดเดียว — ค่าบรรทุกรวม (ไม่มี VAT/หัก ณ ที่จ่าย) + ช่องเซ็น */}
            <div className="print-keep p-4">
              <dl className="ml-auto w-full max-w-sm text-[14px]">
                <div className="flex justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2">
                  <dt className="text-[14px] font-bold text-brand-900">ค่าบรรทุกรวม ({doc.rows.length} ขา)</dt>
                  <dd className="text-[16px] font-extrabold text-brand-900">{money(doc.amount)}</dd>
                </div>
              </dl>
              <div className="grid grid-cols-2 gap-10 pt-10 text-[11px]">
                <div>
                  <div>ผู้วางบิล ........................................</div>
                  <div className="pt-5">วันที่ ........................................</div>
                </div>
                <div>
                  <div>ผู้รับวางบิล ........................................</div>
                  <div className="pt-5">วันที่ ........................................</div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
