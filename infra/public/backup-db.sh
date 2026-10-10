#!/bin/sh
set -eu
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
export PGPASSWORD="$POSTGRES_PASSWORD"
pg_dump -h postgres -U postgres -d "${YAC_BACKUP_DATABASE:-${POSTGRES_DB:-yac}}" -Fc >"/backups/db-$stamp.dump.partial"
mv "/backups/db-$stamp.dump.partial" "/backups/db-$stamp.dump"
echo "Database backup completed: db-$stamp.dump"
