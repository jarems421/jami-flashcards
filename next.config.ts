import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mammoth", "officeparser"],
  async redirects() {
    return [
      {
        source: "/dashboard/practise",
        destination: "/dashboard/practice",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
