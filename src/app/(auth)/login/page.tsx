import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { SearchParams } from "@/lib/params";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect("/");

  const next = typeof sp.next === "string" ? sp.next : "";
  const registered = sp.registered === "1";

  // ยังไม่มีใครในระบบเลย — บอกให้รู้ว่าคนแรกที่สมัครจะเป็นผู้ดูแล
  const isEmpty = (await prisma.user.count().catch(() => 1)) === 0;

  return (
    <div className="card p-6">
      <h2 className="mb-1 text-base font-bold text-slate-900">เข้าสู่ระบบ</h2>
      <p className="mb-5 text-[13px] text-slate-500">กรอกชื่อผู้ใช้และรหัสผ่านที่ผู้ดูแลอนุมัติแล้ว</p>

      {isEmpty && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
          ยังไม่มีผู้ใช้ในระบบ — คนแรกที่ <Link href="/register" className="font-semibold underline">สมัครใช้งาน</Link>{" "}
          จะได้สิทธิ์ผู้ดูแลระบบและเข้าใช้งานได้ทันที
        </div>
      )}

      {registered && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] leading-relaxed text-emerald-900">
          สมัครเรียบร้อยแล้ว — รอผู้ดูแลอนุมัติก่อนจึงจะเข้าระบบได้
        </div>
      )}

      <LoginForm next={next} />

      <p className="mt-5 border-t border-[var(--border)] pt-4 text-center text-[13px] text-slate-500">
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" className="font-semibold text-brand-700 hover:underline">
          สมัครใช้งาน
        </Link>
      </p>
    </div>
  );
}
