#!/bin/sh
set -eu

cd "$(dirname "$0")"
test "$(id -u)" -eq 0 || { echo "Run as root." >&2; exit 1; }
test -f .env || { echo "Create deploy/.env from deploy/.env.example first." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is not installed or not on PATH." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (docker compose)." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "OpenSSL is required to create the private database certificate." >&2; exit 1; }

if ! swapon --show=NAME --noheadings | grep -q .; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
fi

TLS_DIR="$(pwd)/runtime/postgres-tls" \
CA_DIR="$(pwd)/runtime/postgres-ca" \
POSTGRES_UID=70 \
  sh postgres/init-tls.sh

docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml build app migrate
docker compose --env-file .env -f compose.yaml up -d

echo "Deployment started. Check: docker compose --env-file .env -f compose.yaml ps"
