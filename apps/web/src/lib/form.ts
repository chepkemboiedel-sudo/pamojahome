import { redirect } from 'next/navigation';

/** Database errors start with "PamojaHome: " when they are meant for people. */
export function friendly(e: { message?: string } | null | undefined, fallback = 'Something went wrong. Please try again.') {
  const m = e?.message ?? '';
  return m.startsWith('PamojaHome: ') ? m.slice('PamojaHome: '.length).replace(/^./, (c) => c.toUpperCase()) : fallback;
}

/** Redirects back with a message the page shows in a notice. */
export function back(path: string, key: 'error' | 'ok', msg: string): never {
  redirect(`${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(msg)}`);
}

export const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
export const uuid = (v: string) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);

/** Only same-site relative paths, so a form can never redirect off the app. */
export const safePath = (v: string, fallback: string) => (/^\/(?!\/)[\w\-/?=&%.]*$/.test(v) ? v : fallback);
