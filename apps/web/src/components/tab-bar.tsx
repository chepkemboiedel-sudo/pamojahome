'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui';

const TABS = [
  { href: '/', label: 'Home', icon: Icon.Home, match: (p: string) => p === '/' },
  { href: '/chores', label: 'Chores', icon: Icon.List, match: (p: string) => p.startsWith('/chores') || p.startsWith('/confirm') },
  { href: '/money', label: 'Money', icon: Icon.Money, match: (p: string) => p.startsWith('/money') },
  { href: '/me', label: 'Me', icon: Icon.User, match: (p: string) => p.startsWith('/me') },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ href, label, icon: I, match }) => {
          const active = match(path);
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${active ? 'text-brand' : 'text-muted'}`}>
                <I />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
