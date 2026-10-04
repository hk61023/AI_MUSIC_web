#!/usr/bin/env bash
set -euo pipefail
exec 9>/run/tingyu-tls.lock
flock -n 9 || exit 0
source /etc/tingyu-tls.env
: "${CERT_IP:?Set the public IP in /etc/tingyu-tls.env}"
[[ "$CERT_IP" =~ ^[0-9.]+$ ]] || exit 1
cert="/etc/tingyu-tls/certificates/$CERT_IP.crt"
# No downtime for checks. Only a due renewal briefly needs exclusive port 443.
if [ -f "$cert" ] && openssl x509 -checkend 259200 -noout -in "$cert"; then exit 0; fi
was_active=false
if systemctl is-active --quiet nginx; then was_active=true; systemctl stop nginx; fi
resume() { if "$was_active"; then systemctl start nginx; fi; }
trap resume EXIT
umask 077
install -d -m 700 /etc/tingyu-tls
contact=()
if [ -n "${CERT_EMAIL:-}" ]; then contact=(--email "$CERT_EMAIL"); fi
/usr/local/bin/lego run --accept-tos --account-id aimisic-site "${contact[@]}" \
  --path /etc/tingyu-tls --domains "$CERT_IP" \
  --profile shortlived --tls --renew-force --no-random-sleep
openssl x509 -in "$cert" -noout -issuer -dates -ext subjectAltName
