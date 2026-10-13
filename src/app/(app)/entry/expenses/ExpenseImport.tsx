"use client";

/**
 * ปุ่ม «⬆ Import จาก Excel» หน้าค่าใช้จ่าย
 * เลือกไฟล์ → ระบบตรวจทีละแถว (ยังไม่บันทึก) → คนติ๊กเลือก → กด «นำเข้า»
 */

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { ImportRow } from "@/lib/expense-import";
import { commitExpenseImport, expenseTemplateFile, previewExpenseImport } from "./import-actions";

type Preview = { rows: ImportRow[]; skipped: { line: number; text: string }[]; missingHeaders: string[] };

const n = (v: number | null) => (v == null ? "-" : v.toLocaleString("th-TH", { maximumFractionDigits: 2 }));

function saveBase64(base64: string, filename: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExpenseImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    if (input.current) input.current.value = "";
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setError(null);
    setDone(null);
    setPreview(null);
    start(async () => {
      const form = new FormData();
      form.set("file", f);
      const res = await previewExpenseImport(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res);
      setPicked(new Set(res.rows.filter((r) => r.ok && r.checked).map((r) => r.line)));
    });
  };

  const commit = () => {
    if (!file || !preview) return;
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set("file", file);
      form.set("lines", [...picked].join(","));
      const res = await commitExpenseImport(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(`✅ นำเข้าแล้ว ${res.saved} รายการ · รวมเงิน ${n(res.amount)} บาท`);
      close();
      router.refresh();
    });
  };

  const template = () =>
    start(async () => {
      const t = await expenseTemplateFile();
      saveBase64(t.base64, t.filename);
    });

  const rows = preview?.rows ?? [];
  const ready = rows.filter((r) => r.ok && picked.has(r.line));
  const total = ready.reduce((a, r) => a + (r.amount ?? 0), 0);
  const bad = rows.filter((r) => !r.ok).length;

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={pending}>
        {pending && !preview ? "⏳ กำลังอ่านไฟล์…" : "⬆ Import จาก Excel"}
      </button>
      {done && <span className="self-center text-[13px] font-bold text-emerald-700">{done}</span>}
      {error && !preview && <span className="self-center text-[13px] font-bold text-red-700">❌ {error}</span>}

      {preview && file && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={close}>
          <div className="card w-full max-w-7xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
              <h2 className="min-w-0 truncate text-[15px] font-bold text-slate-900">⬆ นำเข้าค่าใช้จ่ายจาก Excel — ไฟล์ «{file.name}»</h2>
              <button type="button" className="btn btn-ghost px-2 py-1" onClick={close}>
                ✕ ปิด
              </button>
            </header>
            <div className="p-4">
              <ul className="mb-3 space-y-1 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-900">
                <li>
                  – <b>ยังไม่บันทึก</b> จนกว่าจะกด «นำเข้า» — ตรวจทีละแถวก่อน ติ๊กออกได้ถ้าไม่เอาแถวไหน · แถวที่มี ❌ ต้องแก้ในไฟล์แล้วเลือกไฟล์ใหม่
                </li>
                <li>– อ่านตามชื่อหัวคอลัมน์ สลับลำดับได้ · ปี พ.ศ. แปลงให้เอง · คนขับจับคู่จากชื่อ → รหัส พขร. · รวมเงินต้องเท่ากับ จำนวน × ราคา/หน่วย</li>
                <li>
                  – ยังไม่มีไฟล์?{" "}
                  <button type="button" className="font-bold underline" onClick={template}>
                    ⬇ โหลดแบบฟอร์มเปล่า
                  </button>{" "}
                  (หัวคอลัมน์ถูกต้องพร้อมกรอก)
                </li>
              </ul>
              {preview.missingHeaders.length > 0 && (
                <p className="mb-3 text-[13px] font-bold text-red-700">
                  ❌ ไฟล์ไม่มีคอลัมน์ {preview.missingHeaders.join(" · ")} — เพิ่มหัวคอลัมน์นี้ในไฟล์
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>นำเข้า</th>
                      <th>แถวในไฟล์</th>
                      <th>วันที่</th>
                      <th>ทะเบียน</th>
                      <th>พขร.</th>
                      <th>ผู้ให้บริการ</th>
                      <th>ประเภท</th>
                      <th>รายละเอียด</th>
                      <th>จำนวน</th>
                      <th>หน่วย</th>
                      <th>ราคา/หน่วย</th>
                      <th>รวมเงิน</th>
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={13}>ไม่พบรายการในไฟล์</td>
                      </tr>
                    )}
                    {rows.map((r) => (
                      <tr key={r.line} className={r.ok ? undefined : "row-danger"}>
                        <td>
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            disabled={!r.ok}
                            checked={r.ok && picked.has(r.line)}
                            onChange={(e) =>
                              setPicked((s) => {
                                const next = new Set(s);
                                if (e.target.checked) next.add(r.line);
                                else next.delete(r.line);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td>{r.line}</td>
                        <td className="whitespace-nowrap">{r.date ?? "—"}</td>
                        <td className="whitespace-nowrap">{r.plate ?? "—"}</td>
                        <td>{r.driver ?? "—"}</td>
                        <td>{r.supplier ?? "—"}</td>
                        <td>{r.category ?? "—"}</td>
                        <td>{r.detail ?? "—"}</td>
                        <td className="num">{n(r.qty)}</td>
                        <td>{r.unit ?? "—"}</td>
                        <td className="num">{n(r.unitPrice)}</td>
                        <td className="num font-bold">{n(r.amount)}</td>
                        <td className="min-w-[16rem] text-left text-[12.5px] leading-relaxed">
                          {r.notes.map((t) => (
                            <div
                              key={t}
                              className={`font-bold ${t.startsWith("❌") ? "text-red-700" : t.startsWith("⚠️") ? "text-amber-700" : "text-emerald-700"}`}
                            >
                              {t}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                    {preview.skipped.map((s) => (
                      <tr key={`s${s.line}`}>
                        <td colSpan={13} className="text-left text-[12.5px] text-slate-500">
                          ⏭ แถว {s.line} ข้าม — ไม่มีวันที่ ประเภท และจำนวนเงิน{s.text ? ` («${s.text}»)` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">❌ {error}</p>}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-primary" onClick={commit} disabled={pending || ready.length === 0}>
                  {pending ? "⏳ กำลังบันทึก…" : `✅ นำเข้า ${ready.length} รายการ`}
                </button>
                <button type="button" className="btn btn-ghost" onClick={close} disabled={pending}>
                  ยกเลิก
                </button>
                <span className="text-[13px] text-slate-600">
                  พร้อมนำเข้า <b>{ready.length}</b> · ❌ ต้องแก้ในไฟล์ <b>{bad}</b> · ข้าม <b>{preview.skipped.length}</b> แถว · รวมเงินที่จะนำเข้า{" "}
                  <b>{n(total)}</b> บาท
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
