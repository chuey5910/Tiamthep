import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { requireAuth } from "@/lib/auth";
import { RESOURCES } from "@/lib/crud";
import { crudExportTable } from "@/lib/crud-export";
import { formatThaiDateTime } from "@/lib/date";
import { baht, num } from "@/lib/format";
import { companyName } from "@/lib/invoice-doc";

export const dynamic = "force-dynamic";
export const metadata = { title: "ส่งออกข้อมูล" };

/**
 * ตารางข้อมูลเป็น PDF — หน้านี้มีไว้ให้ตัวทำ PDF (api/pdf) เปิด
 *   /print/table/advances?from=2026-07-10&to=2026-07-20&q=…
 * แถว/คอลัมน์/ตัวกรอง ตรงกับหน้าจอ (crudExportTable) · คอลัมน์เกิน 7 ใช้ A4 แนวนอน
 */
export default async function PrintTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAuth();
  const { key } = await params;
  const resource = RESOURCES[key];
  if (!resource) notFound();
  const sp = Object.fromEntries(Object.entries(await searchParams).filter((e): e is [string, string] => typeof e[1] === "string"));
  const [t, company] = await Promise.all([crudExportTable(resource, sp), companyName()]);
  const wide = t.headers.length > 7;

  return (
    <div className={`invoice-page${wide ? " rpt-landscape" : ""}`} data-filename={`${t.fileBase}.pdf`} data-missing="0">
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
              <div className="inv-head">
                <Logo className="inv-logo" title={company} />
                <div className="inv-co">
                  <b>{company}</b>
                  <br />
                  ระบบบริหารงานขนส่ง
                </div>
              </div>
              <h1 className="inv-title">{t.title}</h1>
              <div className="inv-info" style={{ marginBottom: 8 }}>
                {t.filterText || "ทั้งหมด"} · {t.rows.length.toLocaleString("th-TH")} รายการ · ออกเอกสารเมื่อ {formatThaiDateTime(new Date())}
              </div>
              <table className="inv-tbl">
                <thead>
                  <tr>
                    <th>ลำดับ</th>
                    {t.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.length === 0 && (
                    <tr>
                      <td colSpan={t.headers.length + 1}>ไม่พบข้อมูลตามเงื่อนไข</td>
                    </tr>
                  )}
                  {t.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="nw">{i + 1}</td>
                      {r.map((v, c) => (
                        <td key={c} className={t.kinds[c] === "text" ? undefined : "r"}>
                          {v == null ? "-" : typeof v === "number" ? (t.kinds[c] === "money" ? baht(v) : num(v)) : v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
