import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core ทำ PDF (api/pdf) — ห้าม bundle รวม ต้องโหลดจาก node_modules ตรงๆ
  serverExternalPackages: ["@prisma/client", "xlsx", "playwright-core"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
