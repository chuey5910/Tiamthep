"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdjustPreview } from "@/lib/invoice-adjust";
import { money } from "@/lib/format";
import { applyAdjust, loadAdjustPreview } from "./actions";

/**
 * หน้าต่าง «ปรับยอดใบนี้» — โชว์ก่อนว่าขาไหนเปลี่ยนอะไร ยอดเดิม → ยอดใหม่ แล้วให้คนกดยืนยันเอง
 * เลขที่ใบ วันที่วางบิล ครบกำหนด คงเดิม
 */
export function AdjustDialog({ billingId, title, onClose }: { billingId: number; title: string; onClose: () => void }) {
  const router = useRouter();
  const [preview, setPreview] = useState<AdjustPreview | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    loadAdjustPreview(billingId).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [billingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = () => {
    if (!preview?.ok) return;
    setError(null);
    start(async () => {
      const res = await applyAdjust(billingId, preview.token);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.amount);
      router.refresh();
    });
  };

  const p = preview;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6"
      onClick={onClose}
    >
      <div className="card w-full max-w-3xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
          <h2 className="text-[15px] font-bold text-slate-900">🔄 ปรับยอด {title}</h2>
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={onClose}>
            ✕ ปิด
          </button>
        </header>

        <div className="p-4 text-[14px]">
          {!p && <p className="text-slate-500">กำลังเทียบข้อมูลตอนออกบิลกับข้อมูลล่าสุด…</p>}

          {p && !p.ok && <p className="font-bold text-red-700">❌ {p.error}</p>}

          {p?.ok && done != null && (
            <p className="font-bold text-emerald-700">
              ✅ ปรับยอดแล้ว — {p.invoiceNo} ยอดใหม่ {money(done)} บาท · กด «📄 PDF» เพื่อดูใบที่ปรับแล้ว
            </p>
          )}

          {p?.ok && done == null && p.same && (
            <p className="font-bold text-emerald-700">✅ ข้อมูลตรงกับใบวางบิลแล้ว ไม่ต้องปรับ</p>
          )}

          {p?.ok && done == null && !p.same && (
            <>
              <p className="font-bold">
                ⚠️ ข้อมูลล่าสุดต่างจากตอนออกบิล{p.changes.length > 0 ? ` ${p.changes.length} ขา` : ""}
              </p>
              {p.changes.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>ลำดับ</th>
                        <th>วันที่</th>
                        <th>ทะเบียน</th>
                        <th>เปลี่ยนอะไร</th>
                        <th className="num">ยอดเดิม</th>
                        <th className="num">ยอดใหม่</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.changes.map((c) => (
                        <tr key={c.seq}>
                          <td>{c.seq}</td>
                          <td className="whitespace-nowrap">{c.date}</td>
                          <td className="whitespace-nowrap">{c.plate}</td>
                          <td>
                            {c.what.map((w) => (
                              <div key={w}>{w}</div>
                            ))}
                          </td>
                          <td className="num">{money(c.oldAmount)}</td>
                          <td className={`num font-bold ${c.newAmount !== c.oldAmount ? "text-red-700" : ""}`}>
                            {money(c.newAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-3 flex justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2 font-bold text-brand-900">
                <span>ค่าบรรทุกรวม ({p.legs} ขา)</span>
                <span>
                  <span className="text-brand-700 line-through opacity-70">{money(p.oldAmount)}</span> →{" "}
                  <span className="text-[16px]">{money(p.newAmount)}</span>
                </span>
              </div>

              <div className="mt-3 text-[12.5px] leading-relaxed text-slate-600">
                {p.notes.map((n) => (
                  <div key={n}>– {n}</div>
                ))}
                <div>
                  – เลขที่ใบคงเดิม <b>{p.invoiceNo}</b> · วันที่วางบิล/ครบกำหนดคงเดิม
                </div>
                <div>– กดยืนยันแล้ว PDF ใบนี้ออกเป็นยอดใหม่ทันที</div>
                <div>– ระบบจดไว้ว่าใครปรับ เมื่อไร ยอดเดิมเท่าไร (กด «ดูยอด» เพื่อดูประวัติ)</div>
              </div>
              {error && <p className="mt-3 font-bold text-red-700">❌ {error}</p>}
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {done != null || !p?.ok || p.same ? "ปิด" : "ยกเลิก"}
          </button>
          {p?.ok && !p.same && done == null && (
            <button type="button" className="btn btn-primary" disabled={pending} onClick={confirm}>
              {pending ? "กำลังบันทึก…" : "✅ ยืนยันปรับยอด"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
