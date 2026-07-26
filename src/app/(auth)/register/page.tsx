import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RegisterForm } from "./RegisterForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "สมัครใช้งาน" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const isFirstUser = (await prisma.user.count().catch(() => 1)) === 0;

  return (
    <div className="card p-6">
      <h2 className="mb-1 text-base font-bold text-slate-900">สมัครใช้งาน</h2>
      <p className="mb-5 text-[13px] leading-relaxed text-slate-500">
        {isFirstUser
          ? "คุณเป็นคนแรกของระบบ จะได้สิทธิ์ผู้ดูแลระบบและเข้าใช้งานได้ทันที"
          : "สมัครแล้วต้องรอผู้ดูแลอนุมัติก่อน จึงจะเข้าระบบได้"}
      </p>

      <RegisterForm />

      <p className="mt-5 border-t border-[var(--border)] pt-4 text-center text-[13px] text-slate-500">
        มีบัญชีอยู่แล้ว?{" "}
        <Link href="/login" className="font-semibold text-brand-700 hover:underline">
          เข้าสู่ระบบ
        </Link>
      </p>
    </div>
  );
}
