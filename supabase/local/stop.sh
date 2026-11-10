#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
ROOT=${LOCAL_DATA:-$(pwd)/.data}  # must be reachable by the postgres OS user when run as root
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || dirname "$(command -v postgres)")}
for p in postgrest gateway; do [ -f "$ROOT/$p.pid" ] && kill "$(cat "$ROOT/$p.pid")" 2>/dev/null; done
RUN=""; if [ "$(id -u)" = 0 ]; then RUN="runuser -u postgres --"; fi
[ -d "$ROOT/pg" ] && $RUN "$PGBIN/pg_ctl" -D "$ROOT/pg" stop -m fast >/dev/null
echo "Local backend stopped."
