"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addFuelEntry, deleteFuelEntry, importFuelFile, type ImportPreview } from "./actions";
import type { Option } from "@/lib/crud";
import { baht, num } from "@/lib/format";

export function FuelImportForm({ layouts }: { layouts: { key: string; label: string; describe: string }[] }) {
  const router = useRouter();
  const [result, setResult] = useState<ImportPreview | null>(null);
  const [pending, start] = useTransition();
  const [source, setSource] = useState(layouts[0]?.key ?? "");

  const active = layouts.find((l) => l.key === source);

  return (
    <div>
      <form
        action={(form) => {
          start(async () => {
            const res = await importFuelFile(form);
            setResult(res);
            if (res.ok && !res.dryRun) router.refresh();
          });
        }}
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <div>
            <label className="lbl">รูปแบบไฟล์ <span className="text-red-500">*</span></label>
            <select name="source" className="inp" value={source} onChange={(e) => setSource(e.target.value)}>
              {layouts.map((l) => (
                <option key={l.key} value={l.key}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="lbl">ไฟล์ที่ export มา (.xlsx / .xls / .csv) <span className="text-red-500">*</span></label>
            <input type="file" name="file" accept=".xlsx,.xls,.csv" className="inp" required />
          </div>
        </div>

        {active && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">ลำดับคอลัมน์ที่ระบบคาดหวัง — {active.describe}</p>}

        <label className="mt-3 flex items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" name="commit" className="h-4 w-4 rounded" />
          บันทึกลงฐานข้อมูลเลย <span className="text-slate-400">(ไม่ติ๊ก = ตรวจสอบอย่างเดียว ยังไม่บันทึก)</span>
        </label>

        <div className="mt-4">
          <button className="btn btn-primary" disabled={pending}>
            {pending ? "กำลังอ่านไฟล์…" : "อัปโหลดและตรวจสอบ"}
          </button>
        </div>
      </form>

      {result && <ImportResult result={result} />}
    </div>
  );
}

function ImportResult({ result }: { result: ImportPreview }) {
  if (!result.ok) {
    return (
      <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
        {result.error}
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div
        className={`rounded-lg border px-3 py-2 text-[13px] ${
          result.dryRun
            ? "border-brand-200 bg-brand-50 text-brand-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }`}
      >
        <b>{result.dryRun ? "ผลการตรวจสอบ (ยังไม่บันทึก)" : "นำเข้าเรียบร้อย"}</b> — ไฟล์ {result.fileName}
        <br />
        อ่านได้ {result.parsed.toLocaleString("th-TH")} แถว · ซ้ำ{" "}
        {result.duplicates.toLocaleString("th-TH")} แถว
        {result.inFileDuplicates > 0 && (
          <> (ในนี้ {result.inFileDuplicates.toLocaleString("th-TH")} แถวเป็นเลขสลิปซ้ำกันเองในไฟล์ — เก็บแถวแรกไว้)</>
        )}
        {result.dryRun ? (
          <> · จะนำเข้าใหม่ {(result.parsed - result.duplicates).toLocaleString("th-TH")} แถว</>
        ) : (
          <> · บันทึกใหม่ {result.imported.toLocaleString("th-TH")} แถว</>
        )}
        <br />
        รวม {num(result.totals.litres, 2)} ลิตร · เป็นเงิน {baht(result.totals.amount)} บาท
        {result.dryRun && (
          <>
            <br />
            <span className="font-semibold">ถ้าตัวเลขถูกต้องแล้ว ให้ติ๊ก &laquo;บันทึกลงฐานข้อมูลเลย&raquo; แล้วอัปโหลดอีกครั้ง</span>
          </>
        )}
      </div>

      {/* สรุปรวมว่ามีอะไรต้องไปเพิ่มในฐานข้อมูลบ้าง — รายละเอียดรายแถวดูในตารางข้างล่าง */}
      {(result.unknownPlates.length > 0 || result.unknownDrivers.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
          <b>ต้องเพิ่มในฐานข้อมูลก่อน ตัวเลขจึงจะเข้ารายงานครบ</b>
          {result.unknownPlates.length > 0 && (
            <div className="mt-0.5">
              ทะเบียนที่ยังไม่มี ({result.unknownPlates.length} คัน): {result.unknownPlates.slice(0, 20).join(", ")}
              {result.unknownPlates.length > 20 && ` และอีก ${result.unknownPlates.length - 20} คัน`}
            </div>
          )}
          {result.unknownDrivers.length > 0 && (
            <div className="mt-0.5">
              รหัส พขร. ที่ยังไม่มี ({result.unknownDrivers.length} คน): {result.unknownDrivers.slice(0, 20).join(", ")}
              {result.unknownDrivers.length > 20 && ` และอีก ${result.unknownDrivers.length - 20} คน`}
            </div>
          )}
        </div>
      )}

      {/* แถวที่ถูกต้องไม่ต้องโชว์ — โชว์เฉพาะแถวที่ต้องแก้ และระบายแดงเฉพาะช่องที่ผิด */}
      {result.problems.length === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
          ✓ ตรวจแล้วทุกแถวถูกต้องครบถ้วน ไม่มีแถวที่ต้องแก้
        </div>
      ) : (
        <div className="rounded-lg border border-red-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
            <b>แถวที่ต้องตรวจสอบ {result.problems.length.toLocaleString("th-TH")} แถว</b>
            <span className="text-[12px]">
              ถูกต้องพร้อมบันทึก {result.cleanRows.toLocaleString("th-TH")} แถว (ไม่แสดง)
            </span>
          </div>
          <div className="max-h-[28rem] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>แถวในไฟล์</th>
                  <th>วันที่</th>
                  <th>ทะเบียน</th>
                  <th>พขร.</th>
                  <th className="num">ลิตร</th>
                  <th className="num">บาท/ลิตร</th>
                  <th className="num">จำนวนเงิน</th>
                  <th>ปัญหาที่พบ</th>
                </tr>
              </thead>
              <tbody>
                {result.problems.map((r, i) => {
                  const bad = (f: string) =>
                    r.badFields.includes(f as never) ? "bg-red-50 font-semibold text-red-700" : "";
                  return (
                    <tr key={i}>
                      <td className={bad("row")}>{r.row}</td>
                      <td className={bad("date")}>{r.date}</td>
                      <td className={bad("plate")}>{r.plate}</td>
                      <td className={bad("driver")}>{r.driverCode ?? "— ไม่มี —"}</td>
                      <td className={`num ${bad("litres")}`}>{num(r.litres, 2)}</td>
                      <td className={`num ${bad("price")}`}>{num(r.pricePerL, 2)}</td>
                      <td className={`num ${bad("amount")}`}>{baht(r.amount)}</td>
                      <td className="text-[12px] leading-relaxed">
                        {r.issues.map((msg, k) => (
                          <div key={k} className={r.willImport ? "text-amber-700" : "text-red-700"}>
                            {r.willImport ? "⚠" : "✕"} {msg}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-red-200 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            <b className="text-red-700">✕ แดง</b> = แถวนี้จะไม่ถูกบันทึก ·{" "}
            <b className="text-amber-700">⚠ ส้ม</b> = บันทึกได้ แต่ข้อมูลไม่ครบ อาจไม่เข้ารายงานบางตัว ·
            ช่องที่ระบายแดงคือช่องที่มีปัญหา — แก้ที่แถวนั้นในไฟล์ต้นทางแล้วอัปโหลดใหม่ได้เลย
          </p>
        </div>
      )}

    </div>
  );
}

export function ManualFuelForm({ vehicles, drivers }: { vehicles: Option[]; drivers: Option[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      action={(form) => {
        setError(null);
        start(async () => {
          const res = await addFuelEntry(form);
          if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ");
          else router.refresh();
        });
      }}
    >
      <div className="grid gap-3 lg:grid-cols-4">
        <div>
          <label className="lbl">วันที่ <span className="text-red-500">*</span></label>
          <input type="date" name="date" className="inp" defaultValue={new Date().toISOString().slice(0, 10)} required />
        </div>
        <div>
          <label className="lbl">ทะเบียนรถ <span className="text-red-500">*</span></label>
          <select name="plate" className="inp" required>
            <option value="">— เลือก —</option>
            {vehicles.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">พขร.</label>
          <select name="driverCode" className="inp">
            <option value="">— ไม่ระบุ —</option>
            {drivers.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">แหล่งเติม</label>
          <select name="source" className="inp">
            <option value="ปั๊มบริษัท">ปั๊มบริษัท</option>
            <option value="FleetCard">FleetCard</option>
          </select>
        </div>
        <div>
          <label className="lbl">จำนวน (ลิตร) <span className="text-red-500">*</span></label>
          <input type="number" step="0.01" name="litres" className="inp" required />
        </div>
        <div>
          <label className="lbl">ราคาต่อลิตร</label>
          <input type="number" step="0.01" name="pricePerL" className="inp" />
        </div>
        <div>
          <label className="lbl">จำนวนเงิน (บาท)</label>
          <input type="number" step="0.01" name="amount" className="inp" />
          <p className="mt-0.5 text-[11px] text-slate-400">กรอกอย่างน้อยหนึ่งในสองช่องนี้</p>
        </div>
        <div>
          <label className="lbl">หมายเหตุ</label>
          <input name="note" className="inp" />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
      )}

      <div className="mt-4">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "กำลังบันทึก…" : "+ เพิ่มรายการ"}
        </button>
      </div>
    </form>
  );
}

export function DeleteFuelButton({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-danger px-2 py-1 text-[12px]"
      disabled={pending}
      onClick={() => {
        if (!confirm("ยืนยันลบรายการเติมน้ำมันนี้?")) return;
        start(async () => {
          const res = await deleteFuelEntry(id);
          if (!res.ok) alert(res.error);
          else router.refresh();
        });
      }}
    >
      ลบ
    </button>
  );
}
