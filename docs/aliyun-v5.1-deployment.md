# v5.2 Alibaba Cloud deployment candidate

This path is additive. It does not replace the v5.0 Cloudflare Worker/D1
deployment, its database, fixed version pages, tags, or releases.

## Runtime shape

- Node.js 22 web service in an Alibaba Cloud VPC
- Alibaba Cloud RDS PostgreSQL in the same mainland region
- Alibaba Cloud Model Studio/Qwen in Beijing
- HTTPS ingress with an ICP-filed domain before public mainland access

The existing application API and browser pages remain unchanged. The portable
database contract is implemented by both the original D1 adapter and the new
PostgreSQL adapter. PostgreSQL `batch()` checks out one client and wraps every
statement in `BEGIN` / `COMMIT`; failures issue `ROLLBACK`. This preserves the
important all-or-nothing writes for urgent chat, urgent mood entries, and their
structured teacher support events.

## Secret handling

Do not paste a model key, database URL, bootstrap token, teacher password, or
student data into source, GitHub, screenshots, build logs, or chat. An API key
previously shared in any conversation must be revoked. Create a new dedicated
key and place it directly in Alibaba Cloud's server-side secret/environment
configuration. The browser receives none of these values.

Required server-side values are documented as empty names in `.env.example`.
The PostgreSQL connection URL is `DATABASE_URL`. Run `pnpm db:postgres:migrate`
with a restricted migration role so that the reviewed base migration
`postgres/0001_v5_1_system.sql` and adult-evaluation migration
`postgres/0002_adult_evaluation.sql` are both applied; the application role
should then receive only the table permissions it needs.

PostgreSQL TLS with certificate verification is the fail-closed default. Only
an isolated local developer database may set `DATABASE_ALLOW_INSECURE_LOCAL=true`;
never set it on Alibaba Cloud. The adult-only Node service also refuses to
start if any school class, account, session, mood, chat or support-event row is
present, so a school database cannot be reused accidentally.

## Adult teacher/expert evaluation

The public EITT path is `/evaluate`. It collects genuine, voluntary adult
teacher/expert evaluations of 12 fixed synthetic student scenarios. It never
creates a real student record and does not prefill research results. Configure
unique one-time codes in `EVALUATION_TEACHER_CODES` and
`EVALUATION_EXPERT_CODES`. The protected `/research` page reads only the
submitted adult evaluation data using `RESEARCH_ACCESS_KEY`; groups with fewer
than five completed participants are hidden.

The four separate consent confirmations, synthetic-case warning, frozen output
versions, withdrawal/deletion path and CSV export are part of the runtime.
Adult evaluation data may only be described as research results after the
applicable ethics/institutional process is complete. Otherwise, use it as
formative prototype feedback. Do not put any access code or research key in the
repository, browser bundle, screenshot or invitation link.

## Deployment gates

This repository intentionally does not perform the following automatically:

1. buy a domain or server;
2. submit identity documents, face verification, school authorization, or an
   ICP filing on behalf of a person or organization;
3. put an exposed API key into a public service;
4. migrate or overwrite an existing D1 database;
5. enable real-minor traffic before ethics, guardian/student consent, teacher
   on-call escalation, data-retention, incident-response, and mainland data
   governance approvals are documented.

Before launch, also add a persistent account-level voice limiter and an actual
teacher alert delivery/acknowledgement channel. The current teacher page is a
queue and polling UI; it is not a guaranteed emergency notification system.

## Verification before any controlled pilot

1. Create an empty PostgreSQL database and a restricted migration role.
2. Set `DATABASE_URL` in the server secret manager and run
   `pnpm db:postgres:migrate` from a trusted administrative job.
3. Build with Node 22 and inject the PostgreSQL runtime override before the
   first request. Do not inject a D1 binding in this separate service.
4. Create the first teacher with a one-time random bootstrap token; remove the
   token from runtime configuration after bootstrap succeeds.
5. Test rollback by forcing `support_events` insertion to fail and confirm no
   urgent message, mood entry, or partial conversation close remains.
6. The public EITT demonstration must disable real-minor registration and use
   adult researchers with synthetic records only. Keep `PUBLIC_DEMO_MODE=true`;
   the server then rejects student-account creation. Only start a separate,
   school-controlled pilot after the gates above are signed off.

For v5.2 personal EITT deployment, also keep `ADULT_EVALUATION_ONLY=true` (or
omit it; omission fails closed). This disables every school-account login,
teacher workbench API, student-data API and account voice API. Adult evaluators
enter only through one-time evaluation codes. Deploy it against a newly created,
empty database that has never held school or student records; never reuse or
restore the D1/RDS database from a school-mode environment.

`server/register-postgres.ts` installs the Node/PostgreSQL runtime binding. It
is deliberately separate from `worker/index.ts`, which remains the v5.0 D1
entry. The final Alibaba Cloud service entry must load this registration module
before importing the built Vinext server bundle; verify this ordering in the
selected Alibaba Cloud container/service template.
