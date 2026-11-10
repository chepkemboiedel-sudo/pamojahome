import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { allocateHousehold, type RunResult } from '@/lib/allocation-runner';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const expected = Buffer.from(`Bearer ${serverEnv.cronSecret()}`);
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Called hourly on Mondays by Supabase Cron (DD-16). Each household gets its week shared out
 * once, as soon as its local Monday begins; later calls that week do nothing.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createServiceClient();
  const { data: households, error } = await db.from('households').select('id');
  if (error) return NextResponse.json({ error: 'could not list households' }, { status: 500 });

  const results: Array<RunResult | { householdId: string; status: 'failed' }> = [];
  for (const h of households ?? []) {
    try {
      results.push(await allocateHousehold(db, h.id));
    } catch (e) {
      console.error('allocation failed', h.id, e);
      results.push({ householdId: h.id, status: 'failed' });
    }
  }
  const count = (s: string) => results.filter((r) => r.status === s).length;
  return NextResponse.json({
    allocated: count('allocated'), alreadyAllocated: count('already_allocated'),
    noChores: count('no_chores'), failed: count('failed'),
  }, { status: count('failed') ? 207 : 200 });
}
