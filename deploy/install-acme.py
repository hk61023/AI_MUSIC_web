"""Install official lego release after verifying the published SHA256 digest."""
import hashlib
import io
import json
import os
import tarfile
import urllib.request

request = urllib.request.Request(
    'https://api.github.com/repos/go-acme/lego/releases/latest',
    headers={'User-Agent': 'aimisic-deployment'},
)
release = json.load(urllib.request.urlopen(request, timeout=30))
assets = release['assets']
archive = next(a for a in assets if a['name'].endswith('_linux_amd64.tar.gz'))
checksums = next(a for a in assets if 'checksums' in a['name'])
data = urllib.request.urlopen(archive['browser_download_url'], timeout=120).read()
sums = urllib.request.urlopen(checksums['browser_download_url'], timeout=30).read().decode()
expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == archive['name'])
assert hashlib.sha256(data).hexdigest() == expected, 'lego checksum mismatch'
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as package:
    binary = package.extractfile('lego').read()
with open('/usr/local/bin/lego', 'wb') as target:
    target.write(binary)
os.chmod('/usr/local/bin/lego', 0o755)
print('Installed verified official release:', release['tag_name'])
