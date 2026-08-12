# Alibaba Cloud Hong Kong deployment (2 vCPU / 2 GiB)

This is the temporary adult-only EITT demonstration path. It keeps the full
synthetic student and teacher interface visible, but it is not authorization to
collect real minor data. PostgreSQL and the application have no host ports;
only Caddy publishes TCP 80/443 and UDP 443.

## Before starting

1. Point a DNS hostname to the server public IP and allow inbound 80/443 in the
   Alibaba Cloud firewall. Keep PostgreSQL 5432 and application 3000 closed.
2. Revoke any Qwen key previously pasted into chat. Create a new dedicated key
   and add it only to `deploy/.env` on the server.
3. Clone this repository, copy `deploy/.env.example` to `deploy/.env`, set the
   hostname/study-disclosure fields, and replace every placeholder. Use URL-safe random
   characters for `POSTGRES_PASSWORD`; do not put real names or schools in
   evaluator codes. Protect the file with `chmod 600 deploy/.env`.
4. Keep `PUBLIC_DEMO_MODE=true`, `ADULT_EVALUATION_ONLY=true`, and
   `SANDBOX_MODE=true`. The database must be new and dedicated to synthetic data.

## Start or update

From the repository root, run:

```sh
sudo sh deploy/install.sh
```

The script enables a 2 GiB swap file when the server has no active swap, builds
with a 1.4 GiB Node heap, applies all PostgreSQL migrations, then starts the
service. Caddy obtains and renews the public certificate for `SITE_HOSTNAME`.

PostgreSQL TLS is independent of public HTTPS. A private CA and a certificate
valid for the Compose hostname `postgres` are created in a Docker volume. The
application mounts only a separate public-CA volume (never the CA private key)
and connects with certificate and hostname
verification. Do not set `DATABASE_ALLOW_INSECURE_LOCAL=true` on the server.

## Verify and operate

```sh
cd deploy
docker compose --env-file .env -f compose.yaml ps
curl --fail --silent --show-error "https://$(sed -n 's/^SITE_HOSTNAME=//p' .env)/api/health"
docker compose --env-file .env -f compose.yaml logs --tail=100 app caddy
```

`/api/health` reports only readiness and performs a real database query. It
never exposes configuration or provider secrets. Back up the `postgres_data`
volume before destructive changes. For an update, pull reviewed source and run
the install script again; migrations are idempotent.

The synthetic school is initialized separately from a trusted administrative
machine. The request must use `POST /api/sandbox/bootstrap`, the server-only
`SANDBOX_ADMIN_KEY` in `X-Sandbox-Admin-Key`, and an `Origin` exactly equal to
the public HTTPS origin. Store the one-time fictional account credentials
returned by that call in a restricted researcher file; never publish the
administrator key. Invite adult teachers and experts through `/evaluate` using
unique one-time codes from the server environment.
