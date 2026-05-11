import type { NextConfig } from 'next';

const backendUrl = process.env.HCI_BACKEND_URL || 'http://localhost:10272';
const backendWsUrl = backendUrl.replace(/^http/, 'ws');

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  async rewrites() {
    return [
      // Proxy API requests to the Express backend
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      // Proxy WebSocket upgrade requests
      {
        source: '/ws',
        destination: `${backendUrl}/ws`,
      },
      // Proxy xterm vendor assets
      {
        source: '/vendor/:path*',
        destination: `${backendUrl}/vendor/:path*`,
      },
      // Proxy plugin routes
      {
        source: '/plugins/:path*',
        destination: `${backendUrl}/plugins/:path*`,
      },
    ];
  },

  // Allow large responses for chat streaming
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
