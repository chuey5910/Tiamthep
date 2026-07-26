import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "ระบบบริหารงานขนส่ง — เทียมเทพ ขนส่ง",
  description: "บันทึกงาน คำนวณต้นทุน และสรุปกำไรขาดทุนของธุรกิจขนส่ง",
};

export const dynamic = "force-dynamic";

async function getCompanyName(): Promise<string> {
  try {
    const s = await prisma.setting.findUnique({ where: { key: "companyName" } });
    return s?.value ?? "บริษัท เทียมเทพ ขนส่ง จำกัด";
  } catch {
    return "บริษัท เทียมเทพ ขนส่ง จำกัด";
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const companyName = await getCompanyName();
  return (
    <html lang="th">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <Shell companyName={companyName}>{children}</Shell>
        {/* ปุ่มพิมพ์รายงาน */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.addEventListener('click',function(e){var t=e.target.closest('[data-print]');if(t){e.preventDefault();window.print();}});`,
          }}
        />
      </body>
    </html>
  );
}
