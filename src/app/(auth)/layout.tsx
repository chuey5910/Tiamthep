import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getCompanyName(): Promise<string> {
  try {
    const s = await prisma.setting.findUnique({ where: { key: "companyName" } });
    return s?.value ?? "บริษัท เทียมเทพ ขนส่ง จำกัด";
  } catch {
    return "บริษัท เทียมเทพ ขนส่ง จำกัด";
  }
}

/** หน้าล็อกอินและสมัครใช้งาน — เข้าได้โดยไม่ต้องล็อกอิน */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const companyName = await getCompanyName();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl text-white">
            🚛
          </div>
          <h1 className="text-lg font-bold text-slate-900">{companyName}</h1>
          <p className="text-[13px] text-slate-500">ระบบบริหารงานขนส่ง</p>
        </div>
        {children}
        <p className="mt-6 text-center text-[11px] text-slate-400">
          ระบบนี้บันทึกการเข้าใช้งานทุกครั้งเพื่อความปลอดภัยของข้อมูล
        </p>
      </div>
    </div>
  );
}
