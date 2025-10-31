import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
  // Add headers for SharedArrayBuffer (required by WASM models)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
