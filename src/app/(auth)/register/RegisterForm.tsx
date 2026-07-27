"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { checkEmployeeName, register } from "../actions";
import { EMPLOYEE_CHECK_ERROR, type EmployeeCheck } from "@/lib/roles";

export function RegisterForm({ requireEmployeeCheck }: { requireEmployeeCheck: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // เก็บค่าที่กรอกไว้เอง ไม่งั้น React ล้างฟอร์มทิ้งหลัง submit
  // แล้วผู้ใช้ต้องพิมพ์ใหม่ทั้งหมดเพียงเพราะพลาดช่องเดียว
  const [f, setF] = useState({ name: "", username: "", phone: "" });
  const bind = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value })),
  });

  // ตรวจชื่อกับทะเบียนพนักงานระหว่างพิมพ์ (หน่วง 600ms กันยิงถี่)
  // ปุ่มสมัครเปิดเฉพาะเมื่อพบชื่อ — ฝั่ง server ตรวจซ้ำอีกชั้นตอนกดส่งเสมอ
  const [empStatus, setEmpStatus] = useState<EmployeeCheck | "idle" | "checking">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!requireEmployeeCheck) return;
    if (timer.current) clearTimeout(timer.current);
    const name = f.name.trim();
    if (!name) {
      setEmpStatus("idle");
      return;
    }
    setEmpStatus("checking");
    timer.current = setTimeout(async () => {
      try {
        setEmpStatus(await checkEmployeeName(name));
      } catch {
        setEmpStatus("idle");
      }
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [f.name, requireEmployeeCheck]);

  const canSubmit = !requireEmployeeCheck || empStatus === "ok" || empStatus === "first";

  if (done) {
    return (
      <div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-[13px] leading-relaxed text-emerald-900">
          ✓ {done}
        </div>
        <Link href="/login" className="btn btn-ghost mt-4 w-full">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    );
  }

  return (
    <form
      action={(form) => {
        setError(null);
        start(async () => {
          const res = await register(form);
          if (!res) return; // ผู้ใช้คนแรก — server action redirect เข้าระบบให้เลย
          if (res.ok) setDone(res.message ?? "สมัครเรียบร้อยแล้ว");
          else setError(res.error ?? "สมัครไม่สำเร็จ");
        });
      }}
    >
      <div className="mb-3">
        <label className="lbl" htmlFor="name">ชื่อ-นามสกุล <span className="text-red-500">*</span></label>
        <input id="name" name="name" className="inp" autoComplete="name" required {...bind("name")} />
        {requireEmployeeCheck && (
          <p className="mt-0.5 text-[11px]" data-emp-status={empStatus}>
            {empStatus === "idle" && (
              <span className="text-slate-400">กรอกชื่อ-นามสกุลให้ตรงกับทะเบียนพนักงานของบริษัท</span>
            )}
            {empStatus === "checking" && <span className="text-slate-400">กำลังตรวจสอบรายชื่อพนักงาน…</span>}
            {(empStatus === "ok" || empStatus === "first") && (
              <span className="font-semibold text-emerald-700">✓ พบชื่อในทะเบียนพนักงาน สมัครได้</span>
            )}
            {empStatus === "notfound" && (
              <span className="text-red-600">{EMPLOYEE_CHECK_ERROR.notfound}</span>
            )}
            {empStatus === "taken" && <span className="text-red-600">{EMPLOYEE_CHECK_ERROR.taken}</span>}
            {empStatus === "inactive" && (
              <span className="text-red-600">{EMPLOYEE_CHECK_ERROR.inactive}</span>
            )}
          </p>
        )}
      </div>

      <div className="mb-3">
        <label className="lbl" htmlFor="username">ชื่อผู้ใช้ <span className="text-red-500">*</span></label>
        <input
          id="username"
          name="username"
          className="inp"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="somchai"
          required
          {...bind("username")}
        />
        <p className="mt-0.5 text-[11px] text-slate-400">
          ใช้ได้เฉพาะ a-z 0-9 และ . _ - @ · ไม่มีเว้นวรรคและภาษาไทย
        </p>
      </div>

      <div className="mb-3">
        <label className="lbl" htmlFor="phone">เบอร์โทร</label>
        <input id="phone" name="phone" className="inp" autoComplete="tel" inputMode="tel" {...bind("phone")} />
        <p className="mt-0.5 text-[11px] text-slate-400">ไว้ให้ผู้ดูแลติดต่อกลับตอนอนุมัติ</p>
      </div>

      <div className="mb-3">
        <label className="lbl" htmlFor="password">รหัสผ่าน <span className="text-red-500">*</span></label>
        <input
          id="password"
          name="password"
          type="password"
          className="inp"
          autoComplete="new-password"
          required
        />
        <p className="mt-0.5 text-[11px] text-slate-400">อย่างน้อย 8 ตัวอักษร มีทั้งตัวอักษรและตัวเลข</p>
      </div>

      <div className="mb-4">
        <label className="lbl" htmlFor="confirm">ยืนยันรหัสผ่าน <span className="text-red-500">*</span></label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          className="inp"
          autoComplete="new-password"
          required
        />
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] leading-relaxed text-red-800">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={pending || !canSubmit}>
        {pending ? "กำลังสมัคร…" : "สมัครใช้งาน"}
      </button>
      {requireEmployeeCheck && !canSubmit && empStatus !== "idle" && empStatus !== "checking" && (
        <p className="mt-2 text-center text-[11px] text-slate-400">
          ปุ่มสมัครจะกดได้เมื่อชื่อตรงกับทะเบียนพนักงานของบริษัท
        </p>
      )}
    </form>
  );
}
