import Link from 'next/link';
import type { ReactNode } from 'react';

export function Screen({ children, nav = true }: { children: ReactNode; nav?: boolean }) {
  return (
    <main className={`mx-auto flex w-full max-w-md flex-col gap-4 px-5 pt-5 ${nav ? 'pb-28' : 'pb-10'}`}>
      {children}
    </main>
  );
}

export function Card({ children, className = '', labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className={`flex flex-col gap-3.5 rounded-2xl border border-line bg-white p-[18px] ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return <h2 id={id} className="m-0 text-lg font-semibold">{children}</h2>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="text-[13px] font-semibold tracking-[0.02em] text-brand">{children}</span>;
}

const buttonBase = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition-colors disabled:opacity-60';
export const buttonStyles = {
  primary: `${buttonBase} bg-brand text-white hover:bg-brand-900`,
  secondary: `${buttonBase} border border-control bg-white text-brand-900 hover:bg-brand-100`,
  quiet: `${buttonBase} text-brand-900 hover:bg-brand-100`,
};

export function Pill({ tone = 'brand', children }: { tone?: 'brand' | 'good' | 'warn' | 'neutral'; children: ReactNode }) {
  const tones = {
    brand: 'bg-brand-100 text-brand-900',
    good: 'bg-good-100 text-good',
    warn: 'bg-sun-200 text-sun-ink',
    neutral: 'bg-page text-muted border border-line',
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-bold ${tones[tone]}`}>{children}</span>;
}

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const light = ['#EC4899', '#F97316', '#0EA5E9', '#14B8A6'].includes(color);
  return (
    <span aria-hidden="true" style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
      className={`inline-flex flex-none items-center justify-center rounded-full font-bold ${light ? 'text-ink' : 'text-white'}`}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function ListLink({ href, icon, iconTone = 'brand', title, detail, trailing }: {
  href: string; icon: ReactNode; iconTone?: 'brand' | 'sun' | 'pink'; title: string; detail?: string; trailing?: ReactNode;
}) {
  const tones = { brand: 'bg-brand-100 text-brand-900', sun: 'bg-sun-200 text-sun-ink', pink: 'bg-pink-100 text-pink-800' };
  return (
    <Link href={href} className="flex min-h-11 items-center gap-3 rounded-[14px] border border-line bg-white p-3.5 text-ink no-underline hover:border-control">
      <span className={`flex size-9 flex-none items-center justify-center rounded-[10px] ${tones[iconTone]}`}>{icon}</span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        {detail && <span className="text-[13px] text-muted">{detail}</span>}
      </span>
      {trailing ?? <Icon.Chevron />}
    </Link>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const tones = {
    info: 'border-line bg-white text-ink',
    error: 'border-pink-300 bg-pink-50 text-pink-900',
    success: 'border-teal-300 bg-good-100 text-good',
  };
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`m-0 rounded-xl border px-4 py-3 text-sm leading-snug ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Field({ id, label, hint, ...input }: { id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <input id={id} name={id} aria-describedby={hint ? `${id}-hint` : undefined}
        className="min-h-12 rounded-xl border border-control bg-white px-3.5 text-base text-ink placeholder:text-muted/70"
        {...input} />
      {hint && <span id={`${id}-hint`} className="text-[13px] text-muted">{hint}</span>}
    </div>
  );
}

const svg = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
export const Icon = {
  Chevron: () => <svg {...svg} width={18} height={18} stroke="#5B5675" strokeWidth={2}><path d="m9 6 6 6-6 6" /></svg>,
  Back: () => <svg {...svg} width={18} height={18} strokeWidth={2}><path d="m15 18-6-6 6-6" /></svg>,
  Clock: () => <svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  Check: () => <svg {...svg} width={16} height={16} strokeWidth={2.2}><path d="M20 6 9 17l-5-5" /></svg>,
  Inbox: () => <svg {...svg}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" /></svg>,
  Wallet: () => <svg {...svg}><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M16 13h2M2 10h20M6 6V4h12v2" /></svg>,
  Home: () => <svg {...svg} width={22} height={22}><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>,
  List: () => <svg {...svg} width={22} height={22}><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" /></svg>,
  Money: () => <svg {...svg} width={22} height={22}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>,
  User: () => <svg {...svg} width={22} height={22}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  Plus: () => <svg {...svg}><path d="M12 5v14M5 12h14" /></svg>,
  Sparkle: () => <svg {...svg}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>,
};
