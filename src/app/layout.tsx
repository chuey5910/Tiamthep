import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ระบบบริหารงานขนส่ง — เทียมเทพ ขนส่ง",
  description: "บันทึกงาน คำนวณต้นทุน และสรุปกำไรขาดทุนของธุรกิจขนส่ง",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
