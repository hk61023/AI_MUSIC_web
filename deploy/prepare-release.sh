#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
release="/opt/tingyu/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o tingyu -g tingyu -m 755 "$release"
tar -xzf /tmp/tingyu-source.tar.gz -C "$release"
chown -R tingyu:tingyu "$release"
cd "$release"
sudo -u tingyu npm ci --no-audit --no-fund
sudo -u tingyu npm run build
sudo -u tingyu npm test
sudo -u tingyu npm prune --omit=dev --no-audit --no-fund
if [ ! -f /etc/tingyu.env ]; then
  : "${SITE_ORIGIN:?Set the exact HTTPS origin}"
  : "${GCS_BUCKET:?Set the private media bucket}"
  [[ "$SITE_ORIGIN" =~ ^https://[a-zA-Z0-9.:-]+$ ]] || exit 1
  [[ "$GCS_BUCKET" =~ ^[a-z0-9._-]+$ ]] || exit 1
  cat > /etc/tingyu.env <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
SITE_ORIGIN=$SITE_ORIGIN
DATA_DIR=/var/lib/tingyu
STORAGE_DRIVER=gcs
GCS_BUCKET=$GCS_BUCKET
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
ENV
  chown root:tingyu /etc/tingyu.env
  chmod 640 /etc/tingyu.env
fi
# Never print the initial password. Owner can retrieve it through sudo.
if [ ! -f /var/lib/tingyu/music.sqlite ]; then
  umask 077
  openssl rand -base64 30 > /etc/tingyu-admin-initial-password
  sudo -u tingyu env DATA_DIR=/var/lib/tingyu node scripts/admin.mjs --password-stdin < /etc/tingyu-admin-initial-password
fi
previous=$(readlink /opt/tingyu/current || true)
ln -sfn "$release" /opt/tingyu/current
install -m 644 deploy/tingyu.service deploy/tingyu-backup.service deploy/tingyu-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable tingyu.service
if ! systemctl restart tingyu.service || ! curl -fsS --retry 10 --retry-delay 1 --retry-connrefused http://127.0.0.1:8787/api/health; then
  if [ -n "$previous" ]; then
    ln -sfn "$previous" /opt/tingyu/current
    systemctl restart tingyu.service
  fi
  echo 'Release failed; previous code restored when available.' >&2
  exit 1
fi
printf '\nRELEASE_READY=%s\n' "$release"
