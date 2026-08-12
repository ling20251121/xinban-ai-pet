#!/bin/sh
set -eu

cd "$(dirname "$0")"
test "$(id -u)" -eq 0 || { echo "Run as root." >&2; exit 1; }
test -f .env || { echo "Create deploy/.env from deploy/.env.example first." >&2; exit 1; }

if ! swapon --show=NAME --noheadings | grep -q .; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
fi

docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml build app migrate
docker compose --env-file .env -f compose.yaml up -d

echo "Deployment started. Check: docker compose --env-file .env -f compose.yaml ps"
