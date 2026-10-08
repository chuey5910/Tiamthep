"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setShipTicketUnused } from "./actions";

/** ตั๋วที่กด «ไม่ใช้» ไปแล้ว — เอากลับมารอตรวจ */
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
          await setShipTicketUnused(id, false);
          router.refresh();
        })
      }
    >
      ↩ กลับมาตรวจ
    </button>
  );
}
