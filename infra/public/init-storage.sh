#!/bin/sh
set -eu
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do sleep 2; done
mc mb --ignore-existing local/yac-manifests
mc version enable local/yac-manifests
mc anonymous set download local/yac-manifests
mc admin user add local "$YAC_S3_ACCESS_KEY" "$YAC_S3_SECRET_KEY"
cat >/tmp/policy.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":["arn:aws:s3:::yac-manifests/cycles/*","arn:aws:s3:::yac-manifests/deployments/*"]}]}
JSON
mc admin policy create local yac-publisher /tmp/policy.json
mc admin policy attach local yac-publisher --user "$YAC_S3_ACCESS_KEY"
