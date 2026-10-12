"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetAllShipTickets } from "./actions";

/** ผู้ดูแล: ล้างตั๋วที่ยังไม่ยืนยันทั้งหมด แล้วอ่านรูปใหม่ทั้งหมด — ถามยืนยันก่อนเสมอ */
export function ResetButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () => {
    const ok = window.confirm(
      [
        "ล้างตั๋วที่ยังไม่ยืนยันทั้งหมด แล้วให้ระบบอ่านรูปใหม่ทั้งหมด?",
        "",
        "– ลบตั๋ว «รอตรวจ» ทุกเส้นทาง และล้างแท็บ «ตั๋วเรือ» ในชีต",
        "– ตั๋วที่ยืนยันเป็นงานแล้ว / กด «ไม่ใช้» แล้ว ไม่ลบ",
        "– ระบบอ่านทุกรูปในโฟลเดอร์ «ตั๋วเรือ» ใหม่เอง ประมาณ 1 ชั่วโมงจนครบ",
      ].join("\n"),
    );
    if (!ok) return;
    start(async () => {
      const r = await resetAllShipTickets();
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      router.refresh();
    });
  };

  return (
    <div className="no-print mb-3 flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={run}>
        🗑 ล้างตั๋วที่ยังไม่ยืนยัน แล้วอ่านใหม่ทั้งหมด
      </button>
      {pending && <span className="text-[13px] text-slate-500">กำลังล้าง…</span>}
      {msg && <span className={`text-[13px] font-bold ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
    </div>
  );
}
