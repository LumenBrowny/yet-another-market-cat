#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$YAC_DB_PASSWORD" <<'SQL'
CREATE ROLE yac LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE yac OWNER TO yac;
GRANT ALL ON SCHEMA public TO yac;
SQL
