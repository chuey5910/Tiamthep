"use client";

import { useState, useTransition } from "react";
import { createUser } from "./actions";

/**
 * ฟอร์มให้ผู้ดูแลสร้างบัญชีโดยตรง — สำหรับผู้บริหารหรือคนที่ไม่มีชื่อ
 * ในทะเบียนพนักงาน บัญชีใช้งานได้ทันทีไม่ต้องรออนุมัติ
 */
export function AddUserForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", username: "", phone: "", password: "" });
  const bind = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value })),
  });

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-ghost" onClick={() => { setOpen(true); setDone(null); }}>
          + สร้างบัญชีเอง (ไม่ผ่านทะเบียนพนักงาน)
        </button>
        {done && <span className="text-[13px] text-emerald-700">✓ {done}</span>}
      </div>
    );
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      action={(form) =>
        start(async () => {
          setError(null);
          const res = await createUser(form);
          if (!res.ok) setError(res.error ?? "สร้างไม่สำเร็จ");
          else {
            setDone(res.message ?? "สร้างบัญชีแล้ว");
            setF({ name: "", username: "", phone: "", password: "" });
            setOpen(false);
          }
        })
      }
    >
      <div>
        <label className="lbl" htmlFor="cu-name">ชื่อ-นามสกุล *</label>
        <input id="cu-name" name="name" className="inp" required {...bind("name")} />
      </div>
      <div>
        <label className="lbl" htmlFor="cu-username">ชื่อผู้ใช้ *</label>
        <input
          id="cu-username"
          name="username"
          className="inp"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="เช่น somsak"
          required
          {...bind("username")}
        />
      </div>
      <div>
        <label className="lbl" htmlFor="cu-phone">เบอร์โทร</label>
        <input id="cu-phone" name="phone" className="inp" inputMode="tel" {...bind("phone")} />
      </div>
      <div>
        <label className="lbl" htmlFor="cu-password">รหัสผ่านตั้งต้น *</label>
        <input
          id="cu-password"
          name="password"
          className="inp"
          autoComplete="new-password"
          placeholder="อย่างน้อย 8 ตัว มีตัวอักษร+ตัวเลข"
          required
          {...bind("password")}
        />
      </div>
      <div>
        <label className="lbl" htmlFor="cu-role">สิทธิ์</label>
        <select id="cu-role" name="role" className="inp" defaultValue="STAFF">
          <option value="STAFF">พนักงาน</option>
          <option value="VIEWER">ดูอย่างเดียว</option>
          <option value="ADMIN">ผู้ดูแลระบบ</option>
        </select>
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "กำลังสร้าง…" : "สร้างบัญชี"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          ยกเลิก
        </button>
      </div>
      {error && (
        <p className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          {error}
        </p>
      )}
      <p className="sm:col-span-2 text-[11px] text-slate-400">
        ใช้กับผู้บริหารหรือผู้ที่ไม่มีชื่อในทะเบียนพนักงาน — บัญชีใช้งานได้ทันที
        แจ้งรหัสผ่านให้เจ้าตัวแล้วให้เปลี่ยนเองเมื่อเข้าระบบครั้งแรก
      </p>
    </form>
  );
}
