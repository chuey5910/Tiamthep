"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { reopenShipTicket } from "./actions";

/** เอาตั๋วกลับมารอตรวจ (ใบที่กด «ไม่ใช้» หรือใบที่งานถูกลบไปแล้ว) */
export function UndoUnused({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-ghost px-2 py-1 text-[12px]"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await reopenShipTicket(id);
          router.refresh();
        })
      }
    >
      ↩ กลับมาตรวจ
    </button>
  );
}
