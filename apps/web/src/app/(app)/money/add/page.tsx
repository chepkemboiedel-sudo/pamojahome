import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { getContext } from '@/lib/household';
import { householdSnapshot } from '@/lib/queries';
import { Icon, Notice, Screen } from '@/components/ui';
import { ExpenseForm } from './expense-form';

export const metadata: Metadata = { title: 'Add expense' };

export default async function AddExpensePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const snap = await householdSnapshot(ctx);
  const people = snap.members.map((m) => ({ id: m.id, name: m.display_name }));
  return (
    <Screen>
      <Link href="/money" className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold text-brand-900">
        <Icon.Back /> Money
      </Link>
      <h1 className="m-0 text-[28px] font-bold">Add expense</h1>
      {sp.error && <Notice tone="error">{sp.error}</Notice>}
      {/* A fresh key per form: resubmitting the same form can never create a second expense (RC-16). */}
      <ExpenseForm people={people} me={ctx.memberId} today={ctx.today} idempotencyKey={randomUUID()} />
    </Screen>
  );
}
