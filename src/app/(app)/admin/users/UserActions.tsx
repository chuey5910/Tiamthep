"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveUser,
  changeRole,
  reactivateUser,
  rejectUser,
  resetPassword,
  suspendUser,
  unlockUser,
} from "./actions";

type Result = { ok: boolean; error?: string; message?: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    start(async () => {
      const res = await fn();
      if (!res.ok) alert(res.error ?? "ทำรายการไม่สำเร็จ");
      else {
        if (res.message) alert(res.message);
        router.refresh();
      }
    });
  };
  return { run, pending };
}

/** ปุ่มอนุมัติคำขอ พร้อมเลือกสิทธิ์ที่จะให้ */
export function ApproveControls({ userId, name }: { userId: string; name: string }) {
  const { run, pending } = useRun();
  const [role, setRole] = useState("STAFF");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select className="inp w-32 py-1 text-[12px]" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="STAFF">พนักงาน</option>
        <option value="VIEWER">ดูอย่างเดียว</option>
        <option value="ADMIN">ผู้ดูแลระบบ</option>
      </select>
      <button
        className="btn btn-primary px-2 py-1 text-[12px]"
        disabled={pending}
        onClick={() =>
          run(() => approveUser(userId, role), `อนุมัติให้ "${name}" เข้าใช้งานด้วยสิทธิ์ที่เลือก?`)
        }
      >
        อนุมัติ
      </button>
      <button
        className="btn btn-danger px-2 py-1 text-[12px]"
        disabled={pending}
        onClick={() =>
          run(
            () => rejectUser(userId),
            `ปฏิเสธคำขอของ "${name}"?\n\nบัญชีจะถูกลบ แต่ประวัติการขอยังเก็บไว้ในบันทึกการเข้าระบบ`,
          )
        }
      >
        ปฏิเสธ
      </button>
    </div>
  );
}

/** ปุ่มจัดการผู้ใช้ที่อนุมัติแล้ว */
export function ManageControls({
  userId,
  name,
  role,
  status,
  locked,
  isSelf,
}: {
  userId: string;
  name: string;
  role: string;
  status: string;
  locked: boolean;
  isSelf: boolean;
}) {
  const { run, pending } = useRun();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        className="inp w-32 py-1 text-[12px]"
        value={role}
        disabled={pending || isSelf}
        title={isSelf ? "เปลี่ยนสิทธิ์ของตัวเองไม่ได้" : undefined}
        onChange={(e) => run(() => changeRole(userId, e.target.value), `เปลี่ยนสิทธิ์ของ "${name}"?`)}
      >
        <option value="STAFF">พนักงาน</option>
        <option value="VIEWER">ดูอย่างเดียว</option>
        <option value="ADMIN">ผู้ดูแลระบบ</option>
      </select>

      {locked && (
        <button
          className="btn btn-ghost px-2 py-1 text-[12px]"
          disabled={pending}
          onClick={() => run(() => unlockUser(userId))}
        >
          ปลดล็อก
        </button>
      )}

      <ResetPasswordButton userId={userId} name={name} />

      {status === "ACTIVE" ? (
        <button
          className="btn btn-danger px-2 py-1 text-[12px]"
          disabled={pending || isSelf}
          title={isSelf ? "ระงับบัญชีตัวเองไม่ได้" : undefined}
          onClick={() =>
            run(
              () => suspendUser(userId),
              `ระงับการใช้งานของ "${name}"?\n\nจะถูกตัดออกจากระบบทันทีทุกเครื่อง`,
            )
          }
        >
          ระงับ
        </button>
      ) : (
        <button
          className="btn btn-ghost px-2 py-1 text-[12px]"
          disabled={pending}
          onClick={() => run(() => reactivateUser(userId), `เปิดใช้งาน "${name}" อีกครั้ง?`)}
        >
          เปิดใช้งาน
        </button>
      )}
    </div>
  );
}

function ResetPasswordButton({ userId, name }: { userId: string; name: string }) {
  const { run, pending } = useRun();
  return (
    <button
      className="btn btn-ghost px-2 py-1 text-[12px]"
      disabled={pending}
      onClick={() => {
        const pw = prompt(`ตั้งรหัสผ่านใหม่ให้ "${name}"\n\nอย่างน้อย 8 ตัวอักษร มีทั้งตัวอักษรและตัวเลข`);
        if (!pw) return;
        run(() => resetPassword(userId, pw));
      }}
    >
      ตั้งรหัสใหม่
    </button>
  );
}
