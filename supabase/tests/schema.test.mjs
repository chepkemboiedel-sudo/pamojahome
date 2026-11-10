// Runs the three migrations on an in-process Postgres 16 (PGlite) with
// Supabase stand-ins, then checks the security and ledger rules.
// Usage: node tests/schema.test.mjs   (from the repo root, after `npm i @electric-sql/pglite`)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();
let passed = 0, failed = 0;

async function setup() {
  await db.exec(readFileSync(path.join(root, 'tests/supabase_stubs.sql'), 'utf8'));
  const dir = path.join(root, 'migrations');
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(path.join(dir, f), 'utf8'));
}

// Run SQL as a signed-in user (authenticated role), the service role, or the owner.
async function as(who, sql, params = []) {
  await db.exec('reset role');
  if (who === 'anon') {
    await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false)");
  } else if (who === 'service') {
    await db.exec("set role service_role; select set_config('request.jwt.claim.sub', '', false)");
  } else if (who) {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${who}', false)`);
  }
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec('reset role'); }
}
const one = async (who, sql, p) => Object.values((await as(who, sql, p))[0] ?? {})[0];

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name, detail); }
}
async function expectError(name, who, sql, params, pattern) {
  try { await as(who, sql, params); check(name, false, '(no error)'); }
  catch (e) { check(name, pattern.test(e.message), `(got: ${e.message})`); }
}

await setup();
console.log('Migrations applied.\n');

// ---- Users and households ----------------------------------------------------
const users = {};
for (const n of ['amani', 'jordan', 'priya', 'leo', 'olu']) {
  users[n] = await one(null, `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${n}@example.com`, JSON.stringify({ display_name: n })]);
}
const { amani: A, jordan: J, priya: P, leo: L, olu: O } = users;
console.log('Households and membership');
check('profile created for each new user', (await one(null, 'select count(*)::int from public.profiles')) === 5);

const H = await one(A, `select public.create_household('Maple Street House', 'Amani', 'America/Los_Angeles')`);
const code = await one(A, 'select public.create_invite($1)', [H]);
check('invite code has the XXXX-XXXX shape', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code));
for (const [u, n] of [[J, 'Jordan'], [P, 'Priya'], [L, 'Leo']]) await as(u, 'select public.join_household($1, $2)', [code, n]);
check('four members joined', (await one(A, 'select count(*)::int from public.household_members')) === 4);
await expectError('non-organizer cannot create invites', J, 'select public.create_invite($1)', [H], /only the household organizer/);

const H2 = await one(O, `select public.create_household('Other Flat', 'Olu')`);
const mid = async (u, h = H) => one(u, 'select private.member_id($1)', [h]);
const [mA, mJ, mP, mL, mO] = [await mid(A), await mid(J), await mid(P), await mid(L), await mid(O, H2)];

console.log('\nHousehold isolation (RC-03)');
check('outsider sees only their own household', (await one(O, 'select count(*)::int from public.households')) === 1);
check('outsider sees no Maple Street members', (await one(O, 'select count(*)::int from public.household_members where household_id = $1', [H])) === 0);
await expectError('outsider cannot record an expense in another household', O,
  `select public.record_expense($1,'x',100,$2,'equal',null,$3)`, [H, mA, randomUUID()], /not a member/);
await expectError('anonymous users cannot read households', 'anon',
  `select * from public.households`, [], /permission denied/);

console.log('\nDirect writes are blocked (RC-02, RC-04)');
await expectError('members cannot insert expenses directly', A,
  `insert into public.expenses (household_id, description, amount_cents, paid_by, split_method, created_by, idempotency_key)
   values ($1,'x',100,$2,'equal',$2,gen_random_uuid())`, [H, mA], /permission denied/);
await expectError('members cannot edit tasks directly', A, `update public.tasks set effort = 1`, [], /permission denied/);
await expectError('members cannot call scheduler functions', A, 'select public.auto_confirm_due()', [], /permission denied/);
await expectError('members cannot read the research export', A, 'select * from public.research_task_export', [], /permission denied/);

// ---- Expenses, splits, idempotency --------------------------------------------
console.log('\nExpenses and splits (US-15, RC-09, RC-16)');
const key1 = randomUUID();
const e1 = await one(A, `select public.record_expense($1,'Pizza night',5830,$2,'equal',null,$3)`, [H, mA, key1]);
const shares = await as(A, 'select member_id, share_cents from public.expense_shares where expense_id = $1', [e1]);
const shareOf = (m) => Number(shares.find((s) => s.member_id === m).share_cents);
check('equal split gives leftover cents to the payer ($14.59)', shareOf(mA) === 1459);
check('others pay $14.57', [mJ, mP, mL].every((m) => shareOf(m) === 1457));
const e1again = await one(A, `select public.record_expense($1,'Pizza night',5830,$2,'equal',null,$3)`, [H, mA, key1]);
check('retry with the same key returns the same expense', e1again === e1);
check('retry created no duplicate', (await one(A, 'select count(*)::int from public.expenses')) === 1);
await expectError('custom split that does not add up is rejected', A,
  `select public.record_expense($1,'Groceries',1000,$2,'custom',$3::jsonb,$4)`,
  [H, mA, JSON.stringify([{ member_id: mA, share_cents: 500 }, { member_id: mJ, share_cents: 400 }]), randomUUID()],
  /must add up|add up to/);
await expectError('custom split cannot include an outsider', A,
  `select public.record_expense($1,'Groceries',1000,$2,'custom',$3::jsonb,$4)`,
  [H, mA, JSON.stringify([{ member_id: mA, share_cents: 500 }, { member_id: mO, share_cents: 500 }]), randomUUID()],
  /foreign key|violates/);

const sumBalances = async () => Number(await one(A, 'select coalesce(sum(balance_cents),0) from public.member_balances'));
const bal = async (m) => Number(await one(A, 'select balance_cents from public.member_balances where member_id = $1', [m]));
check('balances sum to exactly zero (US-16)', (await sumBalances()) === 0);
check('payer is owed $43.71', (await bal(mA)) === 4371);

console.log('\nAppend-only ledger (RC-08)');
await expectError('even the database owner cannot edit an expense', null, `update public.expenses set amount_cents = 1`, [], /append-only/);
await expectError('even the database owner cannot delete a share', null, `delete from public.expense_shares`, [], /append-only/);
await expectError('a non-creator, non-payer member cannot reverse', J, `select public.reverse_entry('expense',$1,'oops')`, [e1], /only the person/);
await as(A, `select public.reverse_entry('expense',$1,'entered twice')`, [e1]);
check('reversal restores every balance to zero', (await bal(mA)) === 0 && (await sumBalances()) === 0);
check('the original expense is still there, marked reversed',
  (await one(A, 'select count(*)::int from public.reversed_entries where entry_id = $1', [e1])) === 1);
await expectError('an entry cannot be reversed twice', A, `select public.reverse_entry('expense',$1,'again')`, [e1], /already been reversed/);

console.log('\nPayments and settle-up (US-17, US-18)');
await as(P, `select public.record_expense($1,'Groceries, Costco',18640,$2,'equal',null,$3)`, [H, mP, randomUUID()]);
await as(J, `select public.record_payment($1,$2,$3,2500,$4)`, [H, mA, mJ, randomUUID()]);
await expectError('you cannot record a payment between two other people', L,
  `select public.record_payment($1,$2,$3,100,$4)`, [H, mA, mJ, randomUUID()], /payments you made or received/);
const sugg = await as(A, 'select * from public.settle_up_suggestions($1)', [H]);
const nonzero = await one(A, 'select count(*)::int from public.member_balances where household_id = $1 and balance_cents <> 0', [H]);
check(`settle-up uses at most ${nonzero - 1} payments`, sugg.length <= nonzero - 1, `(${sugg.length})`);
const userOf = { [mA]: A, [mJ]: J, [mP]: P, [mL]: L };
for (const s of sugg) {
  await as(userOf[s.from_member_id], `select public.record_payment($1,$2,$3,$4,$5)`,
    [H, s.from_member_id, s.to_member_id, s.amount_cents, randomUUID()]);
}
check('recording the suggested payments settles everyone',
  (await one(A, 'select count(*)::int from public.member_balances where household_id = $1 and balance_cents <> 0', [H])) === 0);

// ---- Chores and effort voting ---------------------------------------------------
console.log('\nChores and effort voting (US-05, US-30)');
const c1 = await one(A, `select public.upsert_chore($1,null,'Bathroom deep clean','weekly',3::smallint)`, [H]);
await expectError('only organizers create chores', J, `select public.upsert_chore($1,null,'Mop','weekly',2::smallint)`, [H], /only the household organizer/);
await expectError('effort must be 1 to 5', A, `select public.upsert_chore($1,null,'Mop','weekly',7::smallint)`, [H], /check constraint|violates/);
await as(J, 'select public.cast_effort_vote($1, 5::smallint)', [c1]);
check('one vote keeps the organizer value (3)', (await one(A, 'select effort from public.chores where id = $1', [c1])) === 3);
await as(P, 'select public.cast_effort_vote($1, 4::smallint)', [c1]);
check('two votes: median of 4 and 5 rounds half up to 5', (await one(A, 'select effort from public.chores where id = $1', [c1])) === 5);
await as(L, 'select public.cast_effort_vote($1, 1::smallint)', [c1]);
check('three votes (1, 4, 5): median is 4, so one low vote cannot drag it down', (await one(A, 'select effort from public.chores where id = $1', [c1])) === 4);
check('members see only their own vote', (await one(J, 'select count(*)::int from public.effort_votes')) === 1);
check('vote count is visible without revealing votes', (await one(J, 'select votes from public.effort_vote_counts($1) where chore_id = $2', [H, c1])) === 3);

// ---- Tasks: completion, confirmation, disputes, swaps --------------------------
console.log('\nTasks (US-11 to US-14, US-28, US-33)');
const period = await one('service', `insert into public.scheduling_periods (household_id, starts_on, ends_on, allocation_mode)
  values ($1, '2026-11-09', '2026-11-15', 'workload') returning id`, [H]);
const mkTask = (m, t = 'Bathroom deep clean', eff = 4) => one('service',
  `insert into public.tasks (household_id, period_id, chore_id, title, member_id, due_on, effort)
   values ($1,$2,$3,$4,$5,'2026-11-10',$6) returning id`, [H, period, c1, t, m, eff]);
const t1 = await mkTask(mA);
await expectError('only the assignee can mark a task done', J, 'select public.mark_task_done($1)', [t1], /only the assignee/);
await as(A, 'select public.mark_task_done($1, 55)', [t1]);
await expectError('you cannot confirm your own task', A, 'select public.confirm_task($1)', [t1], /cannot confirm your own/);
await as(J, 'select public.confirm_task($1)', [t1]);
check('confirmed effort counts toward workload', (await one(A, 'select confirmed_points from public.member_workload where member_id = $1', [mA])) === 4);

const t2 = await mkTask(mL, 'Clean kitchen', 4);
await as(L, 'select public.mark_task_done($1)', [t2]);
check('first dispute returns the chore to Assigned', (await one(J, `select public.dispute_task($1,'sink still full')`, [t2])) === 'assigned');
await as(L, 'select public.mark_task_done($1)', [t2]);
check('second dispute escalates to the organizer', (await one(J, `select public.dispute_task($1,'pans on the stove')`, [t2])) === 'escalated');
await expectError('only organizers resolve disputes', P, 'select public.resolve_dispute($1, true)', [t2], /only the household organizer/);
await as(A, `select public.resolve_dispute($1, true, 'Checked, it is done')`, [t2]);
check('dispute history is kept as events',
  (await one(A, 'select count(*)::int from public.task_events where task_id = $1', [t2])) >= 6);

const t3 = await mkTask(mP, 'Mop floors', 4);
await as(P, 'select public.mark_task_done($1)', [t3]);
await db.exec(`update public.tasks set completed_at = now() - interval '49 hours' where id = '${t3}'`);
check('auto-confirm after 48 hours (scheduler)', (await one('service', 'select public.auto_confirm_due()')) === 1);

const one1 = await one(J, `select public.log_one_off_task($1,'Unclogged the sink',3::smallint,40)`, [H]);
check('a logged one-off task waits for confirmation', (await one(J, 'select status from public.tasks where id = $1', [one1])) === 'pending_confirmation');

const t4 = await mkTask(mJ, 'Vacuum', 3); const t5 = await mkTask(mP, 'Dishes', 2);
const sw = await one(J, 'select public.request_swap($1,$2,$3)', [t4, mP, t5]);
await expectError('only the person asked can accept a swap', L, 'select public.respond_swap($1, true)', [sw], /only the person asked/);
await as(P, 'select public.respond_swap($1, true)', [sw]);
check('accepted swap exchanges the two chores',
  (await one(A, 'select member_id from public.tasks where id = $1', [t4])) === mP &&
  (await one(A, 'select member_id from public.tasks where id = $1', [t5])) === mJ);

// ---- Recurring bills -----------------------------------------------------------
console.log('\nRecurring bills (US-27, RC-20)');
await as(A, `select public.upsert_recurring_expense($1,null,'Rent',240000,$2,1::smallint)`, [H, mA]);
check('first run on the 1st creates the bill', (await one('service', `select public.run_recurring_expenses('2026-12-01')`)) === 1);
check('a retried run creates nothing new', (await one('service', `select public.run_recurring_expenses('2026-12-01')`)) === 0);
check('rent is split $600 each',
  (await one(A, `select min(s.share_cents)::int from public.expense_shares s join public.expenses e on e.id = s.expense_id where e.source = 'recurring'`)) === 60000);
check('balances still sum to zero', (await sumBalances()) === 0);

// ---- Move-out and archive --------------------------------------------------------
console.log('\nMove-out (US-04, US-29, RC-14, RC-25)');
await as(L, `select public.start_move_out($1, '2026-11-30')`, [mL]);
await expectError('cannot archive with a balance owed', A, 'select public.archive_member($1)', [mL], /settle the balance/);
const owed = -(await bal(mL));
const toWhom = (await as(A, 'select member_id from public.member_balances where household_id = $1 order by balance_cents desc limit 1', [H]))[0].member_id;
await as(L, 'select public.record_payment($1,$2,$3,$4,$5)', [H, mL, toWhom, owed, randomUUID()]);
await as(A, 'select public.archive_member($1)', [mL]);
check('archived member loses access', (await one(L, 'select count(*)::int from public.households')) === 0);
check('their history stays in the ledger', (await one(A, 'select count(*)::int from public.expense_shares where member_id = $1', [mL])) > 0);
check('balances still sum to zero after archiving', (await sumBalances()) === 0);

// ---- Chore credit -----------------------------------------------------------------
console.log('\nChore credit (US-35, RC-23)');
await expectError('cannot enable without everyone agreeing', A, 'select public.set_chore_credit($1, true, 300)', [H], /not agreed/);
for (const u of [A, J, P]) await as(u, 'select public.give_credit_consent($1)', [H]);
await as(A, 'select public.set_chore_credit($1, true, 300)', [H]);
// Make November effort uneven: Amani 4+8 = 12, Priya 4, Jordan 0 (+3 pending).
const t6 = await mkTask(mA, 'Deep clean fridge', 5); const t7 = await mkTask(mA, 'Windows', 3);
for (const t of [t6, t7]) { await as(A, 'select public.mark_task_done($1)', [t]); await as(J, 'select public.confirm_task($1)', [t]); }
await db.exec(`update public.tasks set confirmed_at = '2026-11-12 18:00+00' where status = 'confirmed'`);
await expectError('cannot use more than the extra effort', A,
  `select public.use_chore_credit($1, 20, '2026-11-01', $2)`, [H, randomUUID()], /extra points available/);
const before = await bal(mA);
const cr = await one(A, `select public.use_chore_credit($1, 6, '2026-11-01', $2)`, [H, randomUUID()]);
check('6 points at $3.00 adds $18.00 to the earner', (await bal(mA)) - before === 1800);
check('credit shares add up exactly', (await one(A, 'select sum(amount_cents)::int from public.chore_credit_shares where credit_id = $1', [cr])) === 1800);
check('balances still sum to zero', (await sumBalances()) === 0);
await as(J, 'select public.withdraw_credit_consent($1)', [H]);
check('withdrawing consent turns credit off', (await one(A, 'select chore_credit_enabled from public.households where id = $1', [H])) === false);

// ---- Receipt storage -------------------------------------------------------------
console.log('\nReceipt storage (RC-22)');
await as(A, `insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${H}/r1.jpg`]);
check('member can upload to their household folder', (await one(A, `select count(*)::int from storage.objects`)) === 1);
await expectError('outsider cannot upload to another household', O,
  `insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${H}/r2.jpg`], /row-level security/);
check('outsider cannot see the receipt', (await one(O, 'select count(*)::int from storage.objects')) === 0);

// ---- Missed-chore weight (DD-05 revision, migration 4) ------------------------
console.log('\nMissed-chore weight (DD-05)');
check('new households count missed chores at half weight',
  (await one(A, 'select missed_weight_pct from public.households where id = $1', [H])) === 50);
const loadOf = async (m) => Number(await one(A, 'select load_points from public.member_workload where member_id = $1', [m]));
const loadBefore = await loadOf(mJ);
const oldPeriod = await one('service', `insert into public.scheduling_periods (household_id, starts_on, ends_on, allocation_mode, missed_weight_pct)
  values ($1, '2020-01-06', '2020-01-12', 'workload', 50) returning id`, [H]);
await as('service', `insert into public.tasks (household_id, period_id, chore_id, title, member_id, due_on, effort)
  values ($1,$2,$3,'Take out trash',$4,'2020-01-07',4)`, [H, oldPeriod, c1, mJ]);
check('the scheduled job marks the overdue task missed', (await one('service', 'select public.mark_missed_tasks()')) >= 1);
check('missed effort is reported separately', Number(await one(A, 'select missed_points from public.member_workload where member_id = $1', [mJ])) === 4);
check('a missed 4-point chore adds 2 to load at 50%', (await loadOf(mJ)) === loadBefore + 2);
await expectError('only organizers change the weight', J, 'select public.set_missed_chore_weight($1, 0::smallint)', [H], /only the household organizer/);
await expectError('the weight must be 0–100%', A, 'select public.set_missed_chore_weight($1, 101::smallint)', [H], /between 0 and 100/);
await as(A, 'select public.set_missed_chore_weight($1, 0::smallint)', [H]);
check('at 0% a missed chore adds nothing', (await loadOf(mJ)) === loadBefore);
await as(A, 'select public.set_missed_chore_weight($1, 100::smallint)', [H]);
check('at 100% a missed chore counts in full', (await loadOf(mJ)) === loadBefore + 4);
await as(A, 'select public.set_missed_chore_weight($1, 50::smallint)', [H]);
check('confirmed points are unchanged by missed chores',
  Number(await one(A, 'select confirmed_points from public.member_workload where member_id = $1', [mJ])) === loadBefore);
await expectError('outsiders cannot change the weight', O, 'select public.set_missed_chore_weight($1, 10::smallint)', [H], /not a member|organizer/);

// ---- Weekly allocation write (migration 5) -------------------------------------
console.log('\nWeekly allocation write');
const alloc = (starts, tasks, adj = []) => as('service',
  `select public.apply_allocation($1, $2::date, 'workload', 50::smallint, $3::jsonb, $4::jsonb) as id`,
  [H, starts, JSON.stringify(tasks), JSON.stringify(adj)]);
const wk = [{ chore_id: c1, member_id: mP, due_on: '2026-11-17', effort: 3, title: 'Bathroom deep clean', reason: 'lowest_load' },
            { chore_id: c1, member_id: mL, due_on: '2026-11-20', effort: 3, title: 'Bathroom deep clean', reason: 'preference' }];
const p1 = (await alloc('2026-11-16', wk, [{ member_id: mL, points: 3, reason: 'rejoin_baseline' }]))[0].id;
check('allocation creates the period and its tasks',
  (await one(A, 'select count(*)::int from public.tasks where period_id = $1', [p1])) === 2);
check('each task keeps the reason for "Why this is yours"',
  (await one(P, `select allocation_reason from public.tasks where period_id = $1 and member_id = $2`, [p1, mP])) === 'lowest_load');
check('assignments are logged as task events',
  (await one(A, `select count(*)::int from public.task_events e join public.tasks t on t.id = e.task_id where t.period_id = $1 and e.action = 'assigned'`, [p1])) === 2);
const p1again = (await alloc('2026-11-16', wk, [{ member_id: mL, points: 3, reason: 'rejoin_baseline' }]))[0].id;
check('a retried run for the same week changes nothing', p1again === p1 &&
  (await one(A, 'select count(*)::int from public.tasks where period_id = $1', [p1])) === 2 &&
  (await one(A, `select count(*)::int from public.workload_adjustments where member_id = $1 and reason = 'rejoin_baseline'`, [mL])) === 1);
await expectError('periods must start on a Monday', 'service',
  `select public.apply_allocation($1, '2026-11-18', 'workload', 50::smallint, '[]'::jsonb)`, [H], /starts on a Monday/);
await expectError('a task outside the week is refused, and nothing is written', 'service',
  `select public.apply_allocation($1, '2026-11-23', 'workload', 50::smallint, $2::jsonb)`,
  [H, JSON.stringify([{ chore_id: c1, member_id: mP, due_on: '2026-12-01', effort: 3, title: 'x', reason: 'lowest_load' }])], /outside the period/);
check('the failed week left no period behind',
  (await one('service', `select count(*)::int from public.scheduling_periods where household_id = $1 and starts_on = '2026-11-23'`, [H])) === 0);
await expectError('members cannot write allocations', A,
  `select public.apply_allocation($1, '2026-11-30', 'workload', 50::smallint, '[]'::jsonb)`, [H], /permission denied/);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
