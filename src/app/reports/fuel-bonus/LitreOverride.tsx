"use client";

import { useState, useTransition } from "react";
import { setActualLitres } from "./actions";

/** ช่องแก้ลิตรจริงรายรอบ — บันทึกเมื่อออกจากช่องหรือกด Enter */
export function LitreOverride({ tripCode, value }: { tripCode: string; value: number | null }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (text === (value == null ? "" : String(value))) return;
    start(async () => {
      const res = await setActualLitres(tripCode, text);
      setError(res.ok ? null : (res.error ?? "บันทึกไม่สำเร็จ"));
    });
  };

  return (
    <div className="flex flex-col items-end">
      <input
        className="inp w-24 text-right"
        inputMode="decimal"
        placeholder="อัตโนมัติ"
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {error && <span className="mt-0.5 text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
