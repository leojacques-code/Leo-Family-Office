import type { NextConfig } from "next";
import { assertPreviewSupabaseConfiguration } from "./src/lib/preview-supabase-config";

assertPreviewSupabaseConfiguration();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
