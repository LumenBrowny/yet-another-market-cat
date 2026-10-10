#!/bin/sh
# Run from the deployed infra/public directory. Never print env files.
set -eu
cd /opt/yac/infra/public
umask 077
case "${1:-health}" in
  backup)
    mkdir -p backups
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    docker compose run --rm --no-deps backup
    docker compose run --rm --no-deps -v /opt/yac/infra/public/backups:/backup --entrypoint /bin/sh minio-init -c 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --overwrite local/yac-manifests /backup/manifests'
    tar czf "backups/config-$stamp.tar.gz" .env secrets compose.yaml Caddyfile
    date -u +%FT%TZ > backups/last-success
    echo "BACKUP OK $stamp; copy backups off this VPS"
    ;;
  health)
    docker compose ps
    df -h /opt/yac
    curl --fail --silent --show-error --max-time 20 "https://$(sed -n 's/^YAC_DOMAIN=//p' .env)/api/health"
    # Publisher SOL is checked and attributed by the backend independently of this HTTP probe.
    test -f backups/last-success || { echo 'WARNING: no successful backup'; exit 1; }
    test -n "$(find backups/last-success -mmin -1500 -print)" || { echo 'WARNING: backup stale'; exit 1; }
    ;;
  audit) docker compose exec -T api dotnet YetAnotherCat.Api.dll audit-manifest-storage ;;
  *) echo 'Usage: ops.sh backup|health|audit'; exit 2 ;;
esac
