// Local stand-in for Supabase's API gateway, for development and end-to-end tests only.
//   /rest/v1/*  → PostgREST (real row-level security, real database functions)
//   /auth/v1/*  → a minimal email + password auth service that issues Supabase-style JWTs
// Never deploy this. Production uses Supabase Auth.
import http from 'node:http';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const REST = process.env.POSTGREST_URL ?? 'http://127.0.0.1:54323';
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET (32+ chars) is required');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

await db.query(`create schema if not exists local_auth;
  create table if not exists local_auth.credentials (user_id uuid primary key references auth.users (id) on delete cascade,
    hash text not null, salt text not null);
  create table if not exists local_auth.refresh_tokens (token text primary key, user_id uuid not null, created_at timestamptz default now());
  revoke all on schema local_auth from public;`);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function sign(claims, secret = SECRET) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
function verify(token) {
  const [h, b, s] = (token ?? '').split('.');
  if (!h || !b || !s) return null;
  const expect = createHmac('sha256', SECRET).update(`${h}.${b}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expect.length || !timingSafeEqual(given, expect)) return null;
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
}

const userJson = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
  email_confirmed_at: new Date().toISOString(), phone: '', confirmed_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data ?? {},
  identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_anonymous: false,
});
async function session(u) {
  const now = Math.floor(Date.now() / 1000), expiresIn = 3600;
  const refresh = randomBytes(24).toString('base64url');
  await db.query('insert into local_auth.refresh_tokens (token, user_id) values ($1, $2)', [refresh, u.id]);
  return {
    access_token: sign({ sub: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, iat: now, exp: now + expiresIn,
      user_metadata: u.raw_user_meta_data ?? {}, app_metadata: { provider: 'email' }, session_id: randomUUID() }),
    token_type: 'bearer', expires_in: expiresIn, expires_at: now + expiresIn, refresh_token: refresh, user: userJson(u),
  };
}
const hash = (pw, salt) => scryptSync(pw, salt, 32).toString('hex');

async function auth(req, res, path, body) {
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  const fail = (status, code, msg) => send(status, { code: status, error_code: code, msg, error: code, error_description: msg });
  const grant = new URL(req.url, 'http://x').searchParams.get('grant_type');

  if (path === '/signup' && req.method === 'POST') {
    const { email, password, data } = body;
    if (!email || !password || password.length < 6) return fail(422, 'weak_password', 'Password should be at least 6 characters.');
    const exists = await db.query('select 1 from auth.users where lower(email) = lower($1)', [email]);
    if (exists.rowCount) return fail(422, 'user_already_exists', 'User already registered');
    const { rows: [u] } = await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *', [email.toLowerCase(), data ?? {}]);
    const salt = randomBytes(16).toString('hex');
    await db.query('insert into local_auth.credentials values ($1, $2, $3)', [u.id, hash(password, salt), salt]);
    return send(200, await session(u));
  }
  if (path === '/token' && grant === 'password') {
    const { rows: [u] } = await db.query(
      'select u.*, c.hash, c.salt from auth.users u join local_auth.credentials c on c.user_id = u.id where lower(u.email) = lower($1)', [body.email ?? '']);
    if (!u || hash(body.password ?? '', u.salt) !== u.hash) return fail(400, 'invalid_credentials', 'Invalid login credentials');
    return send(200, await session(u));
  }
  if (path === '/token' && grant === 'refresh_token') {
    const { rows: [t] } = await db.query('delete from local_auth.refresh_tokens where token = $1 returning user_id', [body.refresh_token ?? '']);
    if (!t) return fail(400, 'refresh_token_not_found', 'Invalid Refresh Token');
    const { rows: [u] } = await db.query('select * from auth.users where id = $1', [t.user_id]);
    return send(200, await session(u));
  }
  const claims = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''));
  if (path === '/user' && req.method === 'GET') {
    if (!claims?.sub) return fail(401, 'bad_jwt', 'invalid JWT');
    const { rows: [u] } = await db.query('select * from auth.users where id = $1', [claims.sub]);
    return u ? send(200, userJson(u)) : fail(404, 'user_not_found', 'User not found');
  }
  if (path === '/logout') {
    if (claims?.sub) await db.query('delete from local_auth.refresh_tokens where user_id = $1', [claims.sub]);
    return send(204);
  }
  return fail(404, 'not_found', `Not handled by the local auth stand-in: ${req.method} ${path}`);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    if (url.pathname.startsWith('/auth/v1')) {
      return await auth(req, res, url.pathname.slice('/auth/v1'.length), raw.length ? JSON.parse(raw.toString()) : {});
    }
    if (url.pathname.startsWith('/rest/v1')) {
      const headers = { ...req.headers };
      delete headers.host; delete headers['content-length'];
      if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
      const r = await fetch(REST + url.pathname.slice('/rest/v1'.length) + url.search, {
        method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw,
      });
      const out = {};
      r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
      res.writeHead(r.status, out);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'local gateway error' }));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Local Supabase gateway on http://127.0.0.1:${PORT}`));
