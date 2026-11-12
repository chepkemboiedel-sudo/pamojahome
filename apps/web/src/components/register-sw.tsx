'use client';

import { useEffect } from 'react';

/** Registers the service worker in production builds (dev reloads stay uncached). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Installing still works without it; nothing to tell the user.
    });
  }, []);
  return null;
}
