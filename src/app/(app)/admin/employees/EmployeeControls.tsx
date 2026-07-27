"use client";

import { useState, useTransition } from "react";
import { addEmployee, deleteEmployee, toggleEmployee, updateEmployee } from "./actions";

export function AddEmployeeForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", position: "" });

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(form) =>
        start(async () => {
          setError(null);
          const res = await addEmployee(form);
          if (!res.ok) setError(res.error ?? "เพิ่มไม่สำเร็จ");
          else setF({ name: "", position: "" });
        })
      }
    >
      <div className="min-w-52 flex-1">
        <label className="lbl" htmlFor="emp-name">ชื่อ-นามสกุล</label>
        <input
          id="emp-name"
          name="name"
          className="inp"
          placeholder="เช่น สมชาย ใจดี"
          required
          value={f.name}
          onChange={(e) => setF((v) => ({ ...v, name: e.target.value }))}
        />
      </div>
      <div className="min-w-40">
        <label className="lbl" htmlFor="emp-position">ตำแหน่ง</label>
        <input
          id="emp-position"
          name="position"
          className="inp"
          placeholder="เช่น ธุรการ"
          value={f.position}
          onChange={(e) => setF((v) => ({ ...v, position: e.target.value }))}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "กำลังเพิ่ม…" : "+ เพิ่มรายชื่อ"}
      </button>
      {error && <p className="w-full text-[12px] text-red-600">{error}</p>}
    </form>
  );
}

export function RowControls({
  id,
  name,
  position,
  active,
  hasUser,
}: {
  id: number;
  name: string;
  position: string | null;
  active: boolean;
  hasUser: boolean;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        action={(form) =>
          start(async () => {
            setError(null);
            const res = await updateEmployee(id, form);
            if (!res.ok) setError(res.error ?? "แก้ไขไม่สำเร็จ");
            else setEditing(false);
          })
        }
      >
        <input name="name" className="inp !w-44 !py-1 text-[13px]" defaultValue={name} required />
        <input name="position" className="inp !w-28 !py-1 text-[13px]" defaultValue={position ?? ""} placeholder="ตำแหน่ง" />
        <button type="submit" className="btn btn-primary px-2 py-1 text-[12px]" disabled={pending}>บันทึก</button>
        <button type="button" className="btn btn-ghost px-2 py-1 text-[12px]" onClick={() => setEditing(false)}>ยกเลิก</button>
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className="btn btn-ghost px-2 py-1 text-[12px]" onClick={() => setEditing(true)}>
        แก้ไข
      </button>
      <button
        type="button"
        className="btn btn-ghost px-2 py-1 text-[12px]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await toggleEmployee(id);
            if (!res.ok) setError(res.error ?? "ไม่สำเร็จ");
          })
        }
      >
        {active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
      </button>
      {!hasUser && (
        <button
          type="button"
          className="btn btn-danger px-2 py-1 text-[12px]"
          disabled={pending}
          onClick={() => {
            if (!confirm(`ลบ "${name}" ออกจากทะเบียนพนักงาน?`)) return;
            start(async () => {
              setError(null);
              const res = await deleteEmployee(id);
              if (!res.ok) setError(res.error ?? "ลบไม่สำเร็จ");
            });
          }}
        >
          ลบ
        </button>
      )}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
