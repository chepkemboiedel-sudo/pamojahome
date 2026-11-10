// End-to-end walkthrough against a running app and local backend (supabase/local/start.sh).
// Usage: node e2e/flow.mjs [baseUrl] [screenshotDir]
// Covers sign-up, household setup, invites, chores, preferences, allocation,
// marking done, peer confirmation, the cron endpoint, and an outsider's view.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? 'e2e/screenshots';
const CRON_SECRET = process.env.CRON_SECRET ?? 'local-cron-secret';
mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const email = (n) => `${n}.${run}@example.com`;

const browser = await chromium.launch();
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Los_Angeles', locale: 'en-US' };
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function signUp(name) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  assert.match(page.url(), /\/sign-in/);
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email(name.toLowerCase()));
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/setup/);
  return page;
}

console.log('PamojaHome end-to-end walkthrough');

// Organizer creates the household.
const signInPage = await (await browser.newContext(ctxOpts)).newPage();
await signInPage.goto(`${BASE}/sign-in`);
await shot(signInPage, '01-sign-in');
const amani = await signUp('Amani');
ok('signed-out visitors are sent to sign-in, and new accounts go to setup');
await shot(amani, '02-setup');
await amani.getByLabel('Household name').fill('Maple Street House');
await amani.getByRole('button', { name: 'Create household' }).click();
await amani.waitForURL(/\/setup\/invite/);
const code = (await amani.locator('text=/^[A-Z0-9]{4}-[A-Z0-9]{4}$/').first().textContent()).trim();
assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
await shot(amani, '03-invite');
ok(`household created; invite code ${code}`);

// Organizer adds chores (US-05).
await amani.goto(`${BASE}/me/chores`);
for (const [name, freq, effort] of [['Clean bathroom', 'weekly', 5], ['Wash dishes', 'daily', 2], ['Take out trash', 'twice_weekly', 1], ['Vacuum living room', 'weekly', 3]]) {
  await amani.getByLabel('Chore', { exact: true }).fill(name);
  await amani.getByLabel('How often').selectOption(freq);
  await amani.locator('fieldset label').filter({ hasText: new RegExp(`^${effort}$`) }).click();
  assert.ok(await amani.getByRole('radio', { name: String(effort), exact: true }).isChecked());
  await amani.getByRole('button', { name: 'Add chore' }).click();
  await amani.getByText(`Saved “${name}”.`).waitFor();
}
ok('organizer added 4 chores');

// Housemates join with the code (US-03).
const housemates = {};
for (const name of ['Jordan', 'Priya']) {
  const p = await signUp(name);
  await p.getByRole('link', { name: /Join with an invite code/ }).click();
  await p.getByLabel('Invite code').fill(code.toLowerCase());
  await p.getByRole('button', { name: 'Join household' }).click();
  await p.waitForURL(`${BASE}/`);
  assert.ok(await p.getByText('Maple Street House · ').isVisible());
  housemates[name] = p;
}
ok('Jordan and Priya joined with the code (entered in lower case)');

// A wrong code is refused with a clear message.
const leo = await signUp('Leo');
await leo.goto(`${BASE}/setup?mode=join`);
await leo.getByLabel('Invite code').fill('ZZZZ-9999');
await leo.getByRole('button', { name: 'Join household' }).click();
await leo.getByText(/invalid or has expired/i).waitFor();
ok('an invalid invite code is refused with a clear message');

// Members cannot add chores; preferences are per member (US-07).
const jordan = housemates.Jordan;
await jordan.goto(`${BASE}/me/chores`);
assert.equal(await jordan.getByRole('button', { name: 'Add chore' }).count(), 0);
const bathroom = jordan.locator('li', { hasText: 'Clean bathroom' });
await bathroom.getByRole('button', { name: 'Dislike' }).click();
await jordan.waitForLoadState('networkidle');
await jordan.reload();
assert.equal(await jordan.locator('li', { hasText: 'Clean bathroom' }).getByRole('button', { name: 'Dislike' }).getAttribute('aria-pressed'), 'true');
await shot(jordan, '04-preferences');
ok('members rate chores but cannot add them');

// Organizer shares out the week (DD-05 engine via apply_allocation).
await amani.goto(`${BASE}/`);
await shot(amani, '05-home-before-allocation');
await amani.getByRole('button', { name: 'Share out this week' }).click();
await amani.waitForURL(/\/chores\?ok=/);
await amani.getByText(/Shared out \d+ chores/).waitFor();
await shot(amani, '06-my-chores');
ok('organizer shared out this week');

// The cron endpoint needs the secret and is idempotent.
const unauth = await fetch(`${BASE}/api/cron/allocate`, { method: 'POST' });
assert.equal(unauth.status, 401);
const cron = await fetch(`${BASE}/api/cron/allocate`, { method: 'POST', headers: { authorization: `Bearer ${CRON_SECRET}` } });
const cronBody = await cron.json();
assert.equal(cron.status, 200);
assert.ok(cronBody.alreadyAllocated >= 1 && cronBody.failed === 0, JSON.stringify(cronBody));
ok(`cron refuses without the secret; a second run changes nothing (${JSON.stringify(cronBody)})`);

// Find a chore assigned to someone and complete it.
let doer = null, doerName = null;
for (const [n, p] of [['Amani', amani], ['Jordan', jordan], ['Priya', housemates.Priya]]) {
  await p.goto(`${BASE}/chores`);
  if (await p.locator('section[aria-labelledby="todo-h"] a').count()) { doer = p; doerName = n; break; }
}
assert.ok(doer, 'someone has a chore to do');
await doer.locator('section[aria-labelledby="todo-h"] a').first().click();
await doer.getByRole('heading', { name: 'Why this is yours' }).waitFor();
const title = (await doer.locator('h1').textContent()).trim();
await shot(doer, '07-chore-detail');
await doer.getByLabel(/How long did it take/).fill('25');
await doer.getByRole('button', { name: 'Mark complete' }).click();
await doer.getByText('Marked complete. A housemate will confirm it.').waitFor();
await shot(doer, '08-marked-complete');
ok(`${doerName} marked “${title}” complete`);

// Someone else confirms it (US-12); the assignee cannot.
const confirmer = doerName === 'Priya' ? jordan : housemates.Priya;
await confirmer.goto(`${BASE}/`);
await confirmer.getByText(/chores? to confirm/).waitFor();
await confirmer.goto(`${BASE}/confirm`);
await shot(confirmer, '09-confirm');
await confirmer.locator('li', { hasText: title }).first().getByRole('button', { name: 'Confirm' }).click();
await confirmer.getByText('Confirmed. Thanks for checking.').waitFor();
await doer.goto(`${BASE}/confirm`);
assert.equal(await doer.locator('li', { hasText: title }).count(), 0);
ok('a housemate confirmed it; the assignee never sees their own chore to confirm');

await amani.goto(`${BASE}/`);
await shot(amani, '10-home');
await amani.goto(`${BASE}/?view=week`);
await shot(amani, '11-home-this-week');
await amani.goto(`${BASE}/me`);
await shot(amani, '13-me');
ok('home and me screens render');

// ---- Money (US-15 to US-19) ------------------------------------------------------
const priya = housemates.Priya;
await amani.goto(`${BASE}/money`);
await amani.getByText('You’re all settled up').waitFor();
await amani.getByRole('link', { name: 'Add expense' }).click();
await amani.waitForURL(/\/money\/add/);
await amani.getByLabel('Description').fill('Groceries, Costco');
await amani.getByLabel('Amount ($)').fill('90.01');
// Equal split preview matches the database: the payer takes the leftover cent (OQ-06).
const shareText = async (p, who) => (await p.locator('li', { hasText: who }).locator('span.tabular-nums').textContent()).trim();
assert.equal(await shareText(amani, 'You'), '$30.01');
assert.equal(await shareText(amani, 'Jordan'), '$30.00');
await shot(amani, '14-add-expense');
// Double-tapping Save still records one expense (button locks, and the idempotency key is per form).
await amani.getByRole('button', { name: 'Save expense' }).dblclick();
await amani.waitForURL(/\/money\?ok=/);
assert.equal(await amani.locator('li', { hasText: 'Groceries, Costco' }).count(), 1);
await amani.getByText('$60.00').first().waitFor(); // Amani is owed 90.01 − 30.01
ok('equal split saved once; the payer is owed the others’ shares');

// Custom split: Save stays off until the shares add up.
await jordan.goto(`${BASE}/money/add`);
await jordan.getByLabel('Description').fill('Pizza night');
await jordan.getByLabel('Amount ($)').fill('30');
await jordan.getByRole('button', { name: 'Custom amounts' }).click();
await jordan.getByLabel('You').fill('20');
await jordan.getByLabel('Amani').fill('5');
await jordan.getByLabel('Priya').fill('0');
await jordan.getByText('$5.00 left').waitFor();
assert.ok(await jordan.getByRole('button', { name: 'Save expense' }).isDisabled());
await shot(jordan, '15-custom-split');
await jordan.getByLabel('Priya').fill('5');
await jordan.getByText('Adds up').waitFor();
await jordan.getByRole('button', { name: 'Save expense' }).click();
await jordan.waitForURL(/\/money\?ok=/);
ok('custom split only saves when the shares add up exactly');

// Balances always sum to zero; settle-up suggests the fewest payments (US-16, US-17).
await priya.goto(`${BASE}/money/settle`);
await priya.getByText('All balances add up to $0.00.').waitFor();
await shot(priya, '16-settle-up');
const priyaPays = priya.locator('li', { hasText: /^You/ }).filter({ has: priya.getByRole('button', { name: 'Record payment' }) });
assert.ok(await priyaPays.count() >= 1, 'Priya owes someone');
await priyaPays.first().getByRole('button', { name: 'Record payment' }).click();
await priya.getByText(/Recorded a \$[\d.]+ payment/).waitFor();
await priya.locator('li', { hasText: 'You' }).filter({ hasText: 'Settled up' }).first().waitFor();
await priya.getByText('All balances add up to $0.00.').waitFor();
ok('Priya recorded her suggested payment and is settled up');

// Only the creator, the payer or an organizer can reverse; reversing keeps history.
await priya.goto(`${BASE}/money`);
const groceriesForPriya = priya.locator('li', { hasText: 'Groceries, Costco' });
assert.equal(await groceriesForPriya.getByText('Reverse this entry').count(), 0);
await amani.goto(`${BASE}/money`);
const pizza = amani.locator('li', { hasText: 'Pizza night' });
await pizza.getByText('Reverse this entry').click();
await pizza.getByLabel(/Reason/).fill('Entered twice');
await pizza.getByRole('button', { name: 'Reverse' }).click();
await amani.getByText('Reversed. The original stays in history').waitFor();
await amani.locator('li', { hasText: 'Pizza night' }).getByText('Reversed', { exact: true }).waitFor();
await amani.getByText('Reversed by you · “Entered twice”').waitFor();
await shot(amani, '12-money');
await amani.goto(`${BASE}/money/settle`);
await amani.getByText('All balances add up to $0.00.').waitFor();
ok('organizer reversed an entry; it stays in history and balances still sum to zero');

// An outsider sees nothing of the household (RLS).
const anyTask = await amani.evaluate(() => null);
void anyTask;
await leo.goto(`${BASE}/`);
await leo.waitForURL(/\/setup/);
await leo.goto(`${BASE}/chores`);
await leo.waitForURL(/\/setup/);
ok('a signed-in user outside the household is kept on setup');

await browser.close();
console.log(`\nAll ${step} checks passed. Screenshots in ${SHOTS}/`);
