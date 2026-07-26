"use client";

import { useState, useTransition } from "react";
import { login } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // React ล้างค่าในฟอร์มทิ้งหลัง submit — ถ้าไม่คุมค่าเอง
  // ผู้ใช้จะต้องพิมพ์ชื่อผู้ใช้ใหม่ทุกครั้งที่รหัสผ่านผิด
  const [username, setUsername] = useState("");

  return (
    <form
      action={(form) => {
        setError(null);
        start(async () => {
          const res = await login(form);
          // สำเร็จแล้ว server action จะพาไปหน้าถัดไปเอง โค้ดตรงนี้จะไม่ทำงาน
          if (res && !res.ok) setError(res.error ?? "เข้าสู่ระบบไม่สำเร็จ");
        });
      }}
    >
      <input type="hidden" name="next" value={next} />

      <div className="mb-3">
        <label className="lbl" htmlFor="username">ชื่อผู้ใช้</label>
        <input
          id="username"
          name="username"
          className="inp"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
        />
      </div>

      <div className="mb-4">
        <label className="lbl" htmlFor="password">รหัสผ่าน</label>
        <input
          id="password"
          name="password"
          type="password"
          className="inp"
          autoComplete="current-password"
          required
        />
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] leading-relaxed text-red-800">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
