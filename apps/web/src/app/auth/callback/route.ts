import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Email confirmation link lands here and is exchanged for a session. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';
  const safeNext = /^\/(?!\/)/.test(next) ? next : '/';
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL('/sign-in?error=That+link+has+expired.+Please+sign+in.', url.origin));
}
