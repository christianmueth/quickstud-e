import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb'
    }
  },
  // Webpack config for Transformers.js
  webpack: (config, { isServer }) => {
    // Handle .node files
    config.resolve.extensions.push('.node');
    
    // Transformers.js uses ONNX runtime - don't bundle on server
    if (isServer) {
      config.externals = [...(config.externals || []), 'onnxruntime-node'];
    }
    
    return config;
  },
  // Cross-Origin Isolation: disable by default to avoid blocking 3rd-party SDKs (e.g., Clerk)
  // Enable only when needed by setting ENABLE_CROSS_ORIGIN_ISOLATION=1 at build time
  async headers() {
    if (process.env.ENABLE_CROSS_ORIGIN_ISOLATION === '1') {
      return [
        {
          source: '/(.*)',
          headers: [
            { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
            { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          ],
        },
      ];
    }
    // Default: no special headers
    return [];
  },
};

export default nextConfig;
