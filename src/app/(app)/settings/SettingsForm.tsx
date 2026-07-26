"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearDemoData, saveSettings } from "./actions";

export function SettingsForm({ values }: { values: Record<string, string> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      action={(form) => {
        setError(null);
        setMsg(null);
        start(async () => {
          const res = await saveSettings(form);
          if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ");
          else {
            setMsg("บันทึกแล้ว");
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <label className="lbl">ชื่อบริษัท</label>
          <input name="companyName" className="inp" defaultValue={values.companyName ?? ""} required />
        </div>
        <div>
          <label className="lbl">เลขประจำตัวผู้เสียภาษี</label>
          <input name="companyTaxId" className="inp" defaultValue={values.companyTaxId ?? ""} />
        </div>
        <div>
          <label className="lbl">อัตราซื้อคืนน้ำมัน (บาท/ลิตร)</label>
          <input
            type="number"
            step="0.01"
            name="fuelBuybackRate"
            className="inp"
            defaultValue={values.fuelBuybackRate ?? "30"}
            required
          />
          <p className="mt-0.5 text-[11px] text-slate-400">
            อัตราที่บริษัทจ่ายคืน พขร. ต่อลิตรที่ประหยัดได้ — ปรับตามราคาน้ำมันจริง
          </p>
        </div>
        <div>
          <label className="lbl">แจ้งเตือนเอกสารล่วงหน้า (วัน)</label>
          <input
            type="number"
            name="docAlertDays"
            className="inp"
            defaultValue={values.docAlertDays ?? "30"}
            required
          />
          <p className="mt-0.5 text-[11px] text-slate-400">ใช้กับภาษี พ.ร.บ. ประกันภัย ประกันสินค้า และใบขับขี่</p>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
      )}
      {msg && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          {msg}
        </p>
      )}

      <div className="mt-4">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
        </button>
      </div>
    </form>
  );
}

export function ClearDemoButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        className="btn btn-danger"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              "ลบข้อมูลตัวอย่างทั้งหมด?\n\nจะลบเฉพาะรายการที่ระบบสร้างไว้ให้ลองใช้ (หมายเหตุ = ข้อมูลตัวอย่าง)\nข้อมูลจริงที่คุณกรอกเองจะไม่ถูกลบ",
            )
          )
            return;
          start(async () => {
            const res = await clearDemoData();
            setMsg(res.ok ? `ลบข้อมูลตัวอย่างแล้ว ${res.removed} รายการ` : (res.error ?? "ลบไม่สำเร็จ"));
            router.refresh();
          });
        }}
      >
        {pending ? "กำลังลบ…" : "ล้างข้อมูลตัวอย่าง"}
      </button>
      {msg && <p className="mt-2 text-[13px] text-slate-600">{msg}</p>}
    </div>
  );
}
