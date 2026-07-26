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
        อ่านได้ {result.parsed.toLocaleString("th-TH")} แถว · ซ้ำกับที่เคยนำเข้าแล้ว{" "}
        {result.duplicates.toLocaleString("th-TH")} แถว
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

      {result.unknownPlates.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <b>⚠ ทะเบียนที่ยังไม่มีในฐานข้อมูลรถ ({result.unknownPlates.length} คัน):</b>{" "}
          {result.unknownPlates.slice(0, 20).join(", ")}
          {result.unknownPlates.length > 20 && ` และอีก ${result.unknownPlates.length - 20} คัน`}
          <br />
          ข้อมูลยังนำเข้าได้ แต่จะไม่ปรากฏในรายงานรายคัน จนกว่าจะเพิ่มทะเบียนเหล่านี้ที่หน้าข้อมูลรถ
        </div>
      )}

      {result.unknownDrivers.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <b>⚠ รหัส พขร. ที่ไม่มีในระบบ:</b> {result.unknownDrivers.slice(0, 20).join(", ")}
          <br />
          แถวเหล่านี้จะไม่ผูกกับ พขร. — ค่าน้ำมันยังเข้ารายงานรายคันตามปกติ
        </div>
      )}

      {result.skipped.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
          <b>แถวที่ข้ามไป:</b>
          <ul className="mt-1 space-y-0.5">
            {result.skipped.map((s, i) => (
              <li key={i}>
                แถวที่ {s.row}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.sample.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="tbl">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ทะเบียน</th>
                <th>พขร.</th>
                <th className="num">ลิตร</th>
                <th className="num">บาท/ลิตร</th>
                <th className="num">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {result.sample.map((r, i) => (
                <tr key={i}>
                  <td>{r.date}</td>
                  <td className={r.known ? "" : "text-amber-700"}>
                    {r.plate} {!r.known && "⚠"}
                  </td>
                  <td>{r.driverCode ?? "-"}</td>
                  <td className="num">{num(r.litres, 2)}</td>
                  <td className="num">{num(r.pricePerL, 2)}</td>
                  <td className="num">{baht(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-slate-400">แสดงตัวอย่าง {result.sample.length} แถวแรก</p>
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
