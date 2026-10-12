"use client";

/**
 * ปุ่ม Export ของตารางข้อมูล — กดแล้วเลือก Excel หรือ PDF → ได้ไฟล์ลงเครื่องทันที
 * ไฟล์มีทุกแถวตามตัวกรองที่เลือกอยู่ (ไม่ใช่แค่หน้าที่เปิดอยู่) คอลัมน์เหมือนบนจอ
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { exportCrudExcel } from "@/app/(app)/crud/export-actions";

/** ให้เบราว์เซอร์บันทึกไฟล์ — ต้องแปะลิงก์ลงหน้าก่อนกด ไม่งั้นบางเบราว์เซอร์ไม่ใช้ชื่อไฟล์ที่ตั้ง */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportMenu({ resourceKey }: { resourceKey: string }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  // ตัวกรองบนจอ (ไม่เอาเลขหน้า/แถวที่กำลังแก้)
  const query = (() => {
    const p = new URLSearchParams(params.toString());
    p.delete("page");
    p.delete("edit");
    return p.toString();
  })();

  // คลิกที่อื่น = ปิดเมนู
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const excel = () => {
    setError(null);
    setBusy("excel");
    start(async () => {
      const res = await exportCrudExcel(resourceKey, query);
      setBusy(null);
      if (!res.ok) return setError(res.error);
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      saveBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), res.filename);
      setOpen(false);
    });
  };

  const pdf = async () => {
    setError(null);
    setBusy("pdf");
    try {
      const path = `/print/table/${resourceKey}${query ? `?${query}` : ""}`;
      const res = await fetch(`/api/pdf?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `ทำ PDF ไม่สำเร็จ (${res.status})`);
      }
      saveBlob(await res.blob(), res.headers.get("X-File-Name") || `${resourceKey}.pdf`);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ทำ PDF ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={box} className="relative">
      <button type="button" className="btn btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        ⬇ Export
      </button>
      {open && (
        <div className="card absolute right-0 z-30 mt-1 flex w-56 flex-col gap-2 p-2 shadow-lg">
          <button type="button" className="btn btn-ghost justify-start" onClick={excel} disabled={busy != null}>
            {busy === "excel" ? "⏳ กำลังทำไฟล์…" : "📗 Excel (.xlsx)"}
          </button>
          <button type="button" className="btn btn-ghost justify-start" onClick={pdf} disabled={busy != null}>
            {busy === "pdf" ? "⏳ กำลังทำไฟล์…" : "📕 PDF"}
          </button>
          <p className="px-1 text-[11px] leading-snug text-slate-500">– ได้ทุกแถวตามที่กรองอยู่ ไม่ใช่แค่หน้านี้</p>
          {error && <p className="px-1 text-[12px] font-bold text-red-700">❌ {error}</p>}
        </div>
      )}
    </div>
  );
}
