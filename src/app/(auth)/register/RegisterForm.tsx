"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { register } from "../actions";

export function RegisterForm() {
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

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "กำลังสมัคร…" : "สมัครใช้งาน"}
      </button>
    </form>
  );
}
