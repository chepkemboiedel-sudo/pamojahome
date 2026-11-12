import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The allocation engine is shared TypeScript source (RC-12), compiled with the app.
  transpilePackages: ['@pamojahome/allocation-engine'],
  webpack(config) {
    // The engine imports './x.js' in ESM style; resolve those to the .ts sources.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
  poweredByHeader: false,
  // Put metadata in <head> for every browser, not streamed into <body>: Chrome only reads
  // the install manifest (and iOS the home-screen icon) from <head>. Our metadata is static.
  htmlLimitedBots: /.*/,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      ],
    }, {
      // Always fetch a fresh service worker, so updates reach installed apps.
      source: '/sw.js',
      headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
    }];
  },
};

export default nextConfig;
