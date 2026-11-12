import type { MetadataRoute } from 'next';

/** Web app manifest (served at /manifest.webmanifest) so phones can install PamojaHome. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PamojaHome',
    short_name: 'PamojaHome',
    description: 'Share the work. Share the costs. Keep it fair.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#6D28D9',
    categories: ['lifestyle', 'productivity', 'finance'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
