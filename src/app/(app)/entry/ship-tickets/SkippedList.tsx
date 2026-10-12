"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SkippedPhoto } from "@/lib/ship-ticket";
import { readSkipped } from "./actions";

/**
 * รูปซ้ำที่ระบบข้าม — บอกทุกรูปว่าไฟล์ไหน ซ้ำกับไฟล์ไหน ให้กดเปิดเทียบได้
 * ข้ามผิด (ไม่ใช่รูปเดียวกันจริง) → กด «ไม่ใช่รูปซ้ำ» ระบบอ่านรูปนั้นให้
 */
export function SkippedList({ items, canEdit }: { items: SkippedPhoto[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <details className="mb-3">
      <summary className="cursor-pointer text-[13px] font-bold text-emerald-700">
        ✅ ข้ามรูปซ้ำ {items.length.toLocaleString("th-TH")} รูป — เป็นสำเนาของรูปที่อ่านไปแล้ว (ทะเบียนเดียวกัน
        ข้อความในรูปตรงกันทุกตัวอักษร) จึงไม่สร้างตั๋วซ้ำ · <span className="underline">กดดูว่ารูปไหน</span>
      </summary>
      {msg && <p className={`mt-2 text-[13px] font-bold ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>ทะเบียน</th>
              <th>รูปที่ข้าม (ชื่อไฟล์)</th>
              <th>ซ้ำกับรูปที่อ่านแล้ว (ชื่อไฟล์)</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.fileId}>
                <td className="nw">{x.plate}</td>
                <td>
                  <a href={x.photoUrl} target="_blank" rel="noopener" className="underline">
                    {x.fileName}
                  </a>
                </td>
                <td>
                  {x.orig ? (
                    <a href={x.orig.photoUrl} target="_blank" rel="noopener" className="underline">
                      {x.orig.fileName}
                      {x.orig.plate !== x.plate ? ` (${x.orig.plate})` : ""}
                    </a>
                  ) : (
                    <span className="text-amber-700">⚠️ ไม่พบรูปเดิมแล้ว — กด «ไม่ใช่รูปซ้ำ» เพื่ออ่านรูปนี้</span>
                  )}
                </td>
                {canEdit && (
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-1 text-[12px]"
                      disabled={pending}
                      title="ดูรูปทั้งสองแล้วไม่ใช่รูปเดียวกัน — ให้ระบบอ่านรูปนี้เป็นตั๋วรอตรวจ"
                      onClick={() =>
                        start(async () => {
                          const r = await readSkipped(x.fileId);
                          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
                          router.refresh();
                        })
                      }
                    >
                      ไม่ใช่รูปซ้ำ — อ่านรูปนี้
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
