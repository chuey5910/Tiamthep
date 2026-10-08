import { Shell } from "@/components/Shell";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { shipPendingCount } from "@/lib/ship-ticket";

export const dynamic = "force-dynamic";

async function getCompanyName(): Promise<string> {
  try {
    const s = await prisma.setting.findUnique({ where: { key: "companyName" } });
    return s?.value ?? "บริษัท เทียมเทพ ขนส่ง จำกัด";
  } catch {
    return "บริษัท เทียมเทพ ขนส่ง จำกัด";
  }
}

/**
 * ทุกหน้าในกลุ่มนี้ต้องเข้าระบบก่อน
 * ยังไม่ได้เข้าระบบ (หรือเซสชันหมดอายุ / ถูกระงับระหว่างใช้งาน) จะถูกพาไปหน้าล็อกอิน
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const companyName = await getCompanyName();

  const pendingCount =
    user.role === "ADMIN" ? await prisma.user.count({ where: { status: "PENDING" } }) : 0;

  // ตัวเลขข้างเมนู — งานที่รอคนจัดการ
  const badges: Record<string, number> = {
    "/admin/users": pendingCount,
    "/entry/ship-tickets": await shipPendingCount(),
  };

  return (
    <Shell companyName={companyName} user={user} badges={badges}>
      {children}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.addEventListener('click',function(e){var t=e.target.closest('[data-print]');if(t){e.preventDefault();window.print();}});`,
        }}
      />
    </Shell>
  );
}
