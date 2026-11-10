#!/usr/bin/env bash
# Starts a throwaway local backend for development and end-to-end tests:
# Postgres 16 with all migrations, PostgREST, and the local auth gateway.
# Requires: Postgres 16 server binaries and a PostgREST binary on PATH (or POSTGREST_BIN).
# Production uses a real Supabase project instead; see supabase/README.md.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=${LOCAL_DATA:-$(pwd)/.data}  # must be reachable by the postgres OS user when run as root
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || dirname "$(command -v postgres)")}
POSTGREST_BIN=${POSTGREST_BIN:-postgrest}
PGPORT=${PGPORT:-54322}
export JWT_SECRET=${JWT_SECRET:-local-dev-secret-at-least-32-characters-long}
AUTHENTICATOR_PW=local-authenticator

# Postgres refuses to run as root; use the postgres OS user when needed.
RUN=""
if [ "$(id -u)" = 0 ]; then RUN="runuser -u postgres --"; fi

rm -rf "$ROOT" && mkdir -p "$ROOT" && chmod 777 "$ROOT"
$RUN "$PGBIN/initdb" -D "$ROOT/pg" -U postgres --auth=trust >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$ROOT/pg" -o "-p $PGPORT -k $ROOT -c listen_addresses=127.0.0.1" -l "$ROOT/pg.log" start >/dev/null
export DATABASE_URL="postgres://postgres@127.0.0.1:$PGPORT/postgres"

psql -q "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ../tests/supabase_stubs.sql
for f in ../migrations/*.sql; do psql -q "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
psql -q "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
create role authenticator login noinherit password '$AUTHENTICATOR_PW';
grant anon, authenticated, service_role to authenticator;
SQL

cat > "$ROOT/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:$AUTHENTICATOR_PW@127.0.0.1:$PGPORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = 54323
CONF
nohup "$POSTGREST_BIN" "$ROOT/postgrest.conf" > "$ROOT/postgrest.log" 2>&1 &
echo $! > "$ROOT/postgrest.pid"
nohup node gateway.mjs > "$ROOT/gateway.log" 2>&1 &
echo $! > "$ROOT/gateway.pid"
sleep 1.5

KEYS=$(node -e "
const { createHmac } = require('node:crypto');
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (c) => { const h = b({ alg: 'HS256', typ: 'JWT' }), p = b(c);
  return h + '.' + p + '.' + createHmac('sha256', process.env.JWT_SECRET).update(h + '.' + p).digest('base64url'); };
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY=' + sign({ role: 'anon', iss: 'local', exp }));
console.log('SUPABASE_SERVICE_ROLE_KEY=' + sign({ role: 'service_role', iss: 'local', exp }));
")
cat > "$ROOT/web.env" <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
$KEYS
CRON_SECRET=local-cron-secret
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV
echo "Local backend running. Copy $ROOT/web.env to apps/web/.env.local."
echo "Stop it with: bash supabase/local/stop.sh"
