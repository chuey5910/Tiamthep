"use client";

/**
 * หน้าต่างดู PDF ก่อนบันทึก — กดปุ่ม → ระบบทำไฟล์ PDF จริง → โชว์ให้ดู → กด «บันทึก PDF»
 *
 * ไฟล์ทำบนเครื่องเว็บ (api/pdf) หน้าตาจึงเหมือนกันทุกเครื่อง ไม่ขึ้นกับการตั้งค่าหน้าต่างพิมพ์
 * ชื่อไฟล์ใช้อักษรอังกฤษ — เบราว์เซอร์ทิ้งชื่อไทยในไฟล์ดาวน์โหลดจาก blob
 */

import { useEffect, useState } from "react";

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string; fileName: string; missing: number }
  | { kind: "error"; message: string };

export function PdfPreview({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let url = "";
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/pdf?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `ทำ PDF ไม่สำเร็จ (${res.status})`);
        }
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        if (!alive) return URL.revokeObjectURL(url);
        setState({
          kind: "ready",
          url,
          fileName: res.headers.get("X-File-Name") || "document.pdf",
          missing: Number(res.headers.get("X-Missing-Legs") || 0),
        });
      } catch (e) {
        if (alive) setState({ kind: "error", message: e instanceof Error ? e.message : "ทำ PDF ไม่สำเร็จ" });
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  // ปิดด้วยปุ่ม Esc ได้
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    if (state.kind !== "ready") return;
    const a = document.createElement("a");
    a.href = state.url;
    a.download = state.fileName;
    // ต้องอยู่ใน DOM จริง ไม่งั้นบางเบราว์เซอร์ไม่ใช้ชื่อไฟล์ที่ตั้งไว้
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-6" onClick={onClose}>
      <div
        className="card flex h-full max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-900">📄 {title}</h2>
          <button type="button" className="btn btn-primary" disabled={state.kind !== "ready"} onClick={save}>
            💾 บันทึก PDF
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ✕ ปิด
          </button>
        </header>

        {state.kind === "ready" && state.missing > 0 && (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] font-medium text-amber-900">
            ⚠️ มี {state.missing} ขาที่หาไม่เจอแล้ว (อาจถูกลบหรือแก้วันที่) จึงไม่อยู่ในไฟล์ — ตรวจที่หน้า บันทึกงานขนส่ง ก่อนส่งลูกค้า
          </p>
        )}

        <div className="min-h-0 flex-1 bg-slate-200">
          {state.kind === "loading" && (
            <div className="flex h-full items-center justify-center text-[14px] text-slate-600">
              ⏳ กำลังสร้างไฟล์ PDF… (ประมาณ 5–10 วินาที)
            </div>
          )}
          {state.kind === "error" && (
            <div className="flex h-full items-center justify-center p-6">
              <p className="max-w-lg rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
                ❌ {state.message}
              </p>
            </div>
          )}
          {state.kind === "ready" && <iframe title={title} src={state.url} className="h-full w-full border-0" />}
        </div>
      </div>
    </div>
  );
}
