import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "xlsx"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
