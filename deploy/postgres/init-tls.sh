#!/bin/sh
set -eu

umask 077
if [ ! -s /tls/ca.crt ] || [ ! -s /tls/server.crt ] || [ ! -s /tls/server.key ]; then
  rm -f /tls/ca.key /tls/ca.crt /tls/server.key /tls/server.csr /tls/server.crt /tls/server.ext
  openssl genrsa -out /tls/ca.key 3072
  openssl req -x509 -new -sha256 -days 825 -key /tls/ca.key \
    -subj "/CN=XinBan PostgreSQL private CA" -out /tls/ca.crt
  openssl genrsa -out /tls/server.key 3072
  openssl req -new -sha256 -key /tls/server.key -subj "/CN=postgres" -out /tls/server.csr
  printf '%s\n' 'subjectAltName=DNS:postgres' 'extendedKeyUsage=serverAuth' > /tls/server.ext
  openssl x509 -req -sha256 -days 397 -in /tls/server.csr \
    -CA /tls/ca.crt -CAkey /tls/ca.key -CAcreateserial \
    -extfile /tls/server.ext -out /tls/server.crt
  rm -f /tls/server.csr /tls/server.ext /tls/ca.srl
fi

chown 70:70 /tls/server.key /tls/server.crt
chmod 600 /tls/server.key
chmod 644 /tls/server.crt /tls/ca.crt
install -m 0644 /tls/ca.crt /ca/ca.crt
