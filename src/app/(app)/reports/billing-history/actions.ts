"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireWrite } from "@/lib/auth";
import { changeLines, previewAdjust, type AdjustPreview } from "@/lib/invoice-adjust";
import { prisma } from "@/lib/prisma";

/** ดูก่อนว่าถ้าปรับยอด จะเปลี่ยนอะไรบ้าง — ยังไม่บันทึกอะไร */
export async function loadAdjustPreview(billingId: number): Promise<AdjustPreview> {
  await requireAuth();
  try {
    const p = await previewAdjust(billingId);
    if (!p.ok) return p;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _apply, ...shown } = p;
    return { ...shown, changes: [...shown.changes], notes: [...shown.notes] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "คำนวณยอดใหม่ไม่สำเร็จ" };
  }
}

/**
 * ยืนยันปรับยอด — เลขที่ใบ/วันที่วางบิล/ครบกำหนด คงเดิม (แบบ ก. ที่เจ้าของเลือก)
 * ต้องได้ผลตรงกับที่คนเห็นตอนกด (token) ไม่งั้นไม่บันทึก กันข้อมูลถูกแก้ระหว่างรอ
 */
export async function applyAdjust(
  billingId: number,
  token: string,
): Promise<{ ok: true; amount: number } | { ok: false; error: string }> {
  const user = await requireWrite();
  try {
    const p = await previewAdjust(billingId);
    if (!p.ok) return p;
    if (p.token !== token) return { ok: false, error: "ข้อมูลเปลี่ยนไประหว่างที่เปิดดูอยู่ — ปิดแล้วกด «ปรับยอดใบนี้» ใหม่อีกครั้ง" };
    if (p.same) return { ok: true, amount: p.oldAmount };

    const { rows, newAmounts, newTotal, periodFrom, periodTo } = p._apply;
    const notes = p.notes.length ? `\n${p.notes.map((n) => `– ${n}`).join("\n")}` : "";

    await prisma.$transaction([
      ...rows.map((r, i) =>
        prisma.customerBillingLine.update({
          where: { id: r.line.id },
          data: { amount: newAmounts[i], ...r.now.snap },
        }),
      ),
      prisma.customerBilling.update({
        where: { id: billingId },
        data: { amount: newTotal, netAmount: newTotal, legs: rows.length, periodFrom, periodTo },
      }),
      prisma.customerBillingAdjustment.create({
        data: {
          billingId,
          adjustedBy: user.name,
          oldAmount: p.oldAmount,
          newAmount: newTotal,
          detail: changeLines(p.changes) + notes,
        },
      }),
    ]);

    revalidatePath("/", "layout");
    return { ok: true, amount: newTotal };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ปรับยอดไม่สำเร็จ" };
  }
}
