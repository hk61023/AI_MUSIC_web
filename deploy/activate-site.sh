#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
set -a
source /etc/tingyu.env
set +a
cd /opt/tingyu/current
sudo -u tingyu env GCS_BUCKET="$GCS_BUCKET" node deploy/verify-gcs.mjs
systemctl start tingyu-backup.service
systemctl enable --now tingyu-backup.timer
curl -fsS "$SITE_ORIGIN/api/health"
curl -fsS "$SITE_ORIGIN/api/catalog"
nginx -t
systemctl is-active tingyu nginx
systemctl list-timers tingyu-backup.timer tingyu-tls.timer --no-pager
