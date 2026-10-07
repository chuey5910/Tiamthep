/**
 * หน้าตาใบวางบิล 1 ใบ — ใช้ทำ PDF (src/app/print/...) ให้ออกมาเหมือนกันทุกครั้ง
 *
 * แบบที่เจ้าของอนุมัติ (ภาพตัวอย่าง 7 ต.ค. 2569):
 *  – A4 แนวตั้ง ขอบตามระเบียบงานสารบรรณ (บน 2.5 · ล่าง 2 · ซ้าย-ขวา 2 ซม.)
 *  – ตารางมีเส้นทั้งแนวนอนและแนวตั้ง ระยะบรรทัดมาตรฐาน อ่านง่าย
 *  – หัวตารางครบพร้อมหน่วย ขึ้นบรรทัดใหม่ตรงช่องว่าง ไม่ตัดกลางคำ · "ลำดับ" บรรทัดเดียว
 *  – ทะเบียนรถเฉพาะตัวแม่ · น้ำหนักอยู่กลางคอลัมน์ · ราคาต่อหน่วยเป็นตัวเลขล้วน หน่วยอยู่บนหัว
 * โลโก้ใช้ไฟล์ตัวจริงผ่าน <Logo /> เท่านั้น — ห้ามแก้ไขโลโก้
 */

import { Logo } from "@/components/Logo";
import type { InvoiceDoc } from "@/lib/invoice-doc";
import { money } from "@/lib/format";

/** ทศนิยม 2 ตำแหน่งตายตัว (30.90 · 182.00) ให้ตัวเลขทุกแถวยาวเท่ากัน ตรงแนวกัน */
const fixed2 = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InvoiceDocument({ doc }: { doc: InvoiceDoc }) {
  const c = doc.customer;
  const fmtW = (w: number | null) => (w != null ? fixed2(w) : "-");
  const fmtRate = (v: number | null) => (v != null ? fixed2(v) : "-");
  return (
    <table className="print-sheet inv-doc">
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
            <div className="inv-head">
              <Logo className="inv-logo" title={doc.companyName} />
              <div className="inv-co">
                <b>{doc.companyName}</b>
                <br />
                ระบบบริหารงานขนส่ง
              </div>
            </div>

            <div className="inv-top">
              <div>
                <h1 className="inv-title">
                  ใบวางบิล — {c.code} {c.name}
                </h1>
                <div className="inv-info">
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
              <div className="inv-no">
                {doc.invoiceNo ? (
                  <>
                    <b>เลขที่ {doc.invoiceNo}</b>
                    <br />
                    วันที่วางบิล {doc.billedAt}
                    {doc.dueAt && (
                      <>
                        <br />
                        ครบกำหนดชำระ {doc.dueAt}
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-slate-500">ร่าง — ยังไม่ออกเลขที่</span>
                )}
              </div>
            </div>

            <table className="inv-tbl">
              <thead>
                <tr>
                  <th>ลำดับ</th>
                  <th>วันที่</th>
                  <th>ทะเบียนรถ</th>
                  <th>
                    เลขที่ตั๋ว
                    <br />
                    ต้นทาง
                  </th>
                  <th>ต้นทาง</th>
                  <th>ปลายทาง</th>
                  <th>
                    น้ำหนักต้นทาง
                    <br />
                    (ตัน)
                  </th>
                  <th>
                    น้ำหนักปลายทาง
                    <br />
                    (ตัน)
                  </th>
                  <th>
                    ราคาต่อหน่วย
                    <br />
                    {doc.rateUnit ? `(บาท/${doc.rateUnit})` : "(บาท)"}
                  </th>
                  <th>
                    ค่าบรรทุก
                    <br />
                    (บาท)
                  </th>
                </tr>
              </thead>
              <tbody>
                {doc.rows.map((r) => (
                  <tr key={r.seq}>
                    <td className="c">{r.seq}</td>
                    <td className="nw">{r.date}</td>
                    <td className="nw">{r.plate}</td>
                    <td className="nw">{r.ticket}</td>
                    <td className="nw">{r.origin}</td>
                    <td className="nw">{r.destination}</td>
                    <td className="c">{fmtW(r.weightOrigin)}</td>
                    <td className="c">{fmtW(r.weightDest)}</td>
                    {/* ใบที่ปนหลายหน่วย (ตัน + เที่ยว) บอกหน่วยในช่อง — ไม่งั้นอ่านตัวเลขผิดได้ */}
                    <td className="r">
                      {fmtRate(r.rate)}
                      {!doc.rateUnit && r.rate != null && <span className="inv-unit">/{r.rateUnit}</span>}
                    </td>
                    <td className="r">{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>รวม {doc.rows.length} ขา</td>
                  <td className="c">{fixed2(doc.sumWeightOrigin)}</td>
                  <td className="c">{fixed2(doc.sumWeightDest)}</td>
                  <td className="c">—</td>
                  <td className="r">{money(doc.amount)}</td>
                </tr>
              </tfoot>
            </table>

            {/* ท้ายบิล: ค่าบรรทุกรวม (ไม่มี VAT/หัก ณ ที่จ่าย) + ช่องเซ็น — อยู่หน้าเดียวกันทั้งก้อน */}
            <div className="print-keep">
              <div className="inv-total">
                <span>ค่าบรรทุกรวม ({doc.rows.length} ขา)</span>
                <b>{money(doc.amount)}</b>
              </div>
              <div className="inv-sign">
                <div>
                  ผู้วางบิล ........................................
                  <div>วันที่ ........................................</div>
                </div>
                <div>
                  ผู้รับวางบิล ........................................
                  <div>วันที่ ........................................</div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
