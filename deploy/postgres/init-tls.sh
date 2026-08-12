#!/bin/sh
set -eu

TLS_DIR="${TLS_DIR:-/tls}"
CA_DIR="${CA_DIR:-/ca}"
POSTGRES_UID="${POSTGRES_UID:-70}"
mkdir -p "$TLS_DIR" "$CA_DIR"

umask 077
if [ ! -s "$TLS_DIR/ca.crt" ] || [ ! -s "$TLS_DIR/server.crt" ] || [ ! -s "$TLS_DIR/server.key" ]; then
  rm -f "$TLS_DIR/ca.key" "$TLS_DIR/ca.crt" "$TLS_DIR/server.key" "$TLS_DIR/server.csr" "$TLS_DIR/server.crt" "$TLS_DIR/server.ext"
  openssl genrsa -out "$TLS_DIR/ca.key" 3072
  openssl req -x509 -new -sha256 -days 825 -key "$TLS_DIR/ca.key" \
    -subj "/CN=XinBan PostgreSQL private CA" -out "$TLS_DIR/ca.crt"
  openssl genrsa -out "$TLS_DIR/server.key" 3072
  openssl req -new -sha256 -key "$TLS_DIR/server.key" -subj "/CN=postgres" -out "$TLS_DIR/server.csr"
  printf '%s\n' 'subjectAltName=DNS:postgres' 'extendedKeyUsage=serverAuth' > "$TLS_DIR/server.ext"
  openssl x509 -req -sha256 -days 397 -in "$TLS_DIR/server.csr" \
    -CA "$TLS_DIR/ca.crt" -CAkey "$TLS_DIR/ca.key" -CAcreateserial \
    -extfile "$TLS_DIR/server.ext" -out "$TLS_DIR/server.crt"
  rm -f "$TLS_DIR/server.csr" "$TLS_DIR/server.ext" "$TLS_DIR/ca.srl"
fi

chown "$POSTGRES_UID:$POSTGRES_UID" "$TLS_DIR/server.key" "$TLS_DIR/server.crt"
chmod 600 "$TLS_DIR/server.key"
chmod 644 "$TLS_DIR/server.crt" "$TLS_DIR/ca.crt"
install -m 0644 "$TLS_DIR/ca.crt" "$CA_DIR/ca.crt"
