#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl xz-utils ffmpeg nginx python3 unattended-upgrades
install -d -m 755 /opt/tingyu/releases /opt/tingyu/tools
cd /opt/tingyu/tools
python3 - <<'PY'
import json, urllib.request
versions=json.load(urllib.request.urlopen('https://nodejs.org/dist/index.json'))
version=next(v['version'] for v in versions if v['version'].startswith('v24.') and v['lts'])
open('node-version','w').write(version)
PY
version=$(cat node-version)
archive="node-$version-linux-x64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/$version/$archive"
curl -fsSLo SHASUMS256.txt "https://nodejs.org/dist/$version/SHASUMS256.txt"
grep "  $archive\$" SHASUMS256.txt | sha256sum -c -
tar -xJf "$archive" -C /opt/tingyu/tools
ln -sfn "/opt/tingyu/tools/node-$version-linux-x64/bin/node" /usr/bin/node
ln -sfn "/opt/tingyu/tools/node-$version-linux-x64/bin/npm" /usr/bin/npm
ln -sfn "/opt/tingyu/tools/node-$version-linux-x64/bin/npx" /usr/bin/npx
id tingyu >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/tingyu --shell /usr/sbin/nologin tingyu
install -d -o tingyu -g tingyu -m 700 /var/lib/tingyu
# No public HTTP listener: certificates use TLS-ALPN on 443.
if [ -L /etc/nginx/sites-enabled/default ]; then unlink /etc/nginx/sites-enabled/default; fi
nginx -t
systemctl reload nginx
node --version
ffmpeg -version | head -n 1
