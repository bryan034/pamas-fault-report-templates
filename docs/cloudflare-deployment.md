# Cloudflare and Supabase deployment

The checked-in configuration prepares staging and production. Deploying it
requires your Cloudflare account, domain, Supabase database and Google client;
source/build checks alone do not provision or verify these resources.

```text
Browser → frontend Worker
  /api/* → private service binding → backend Worker → Python container
    → Supabase PostgreSQL
    → private egress handler → ONLYOFFICE container
        → signed source download → private egress handler → Python
```

Both containers are provisioned by the backend Wrangler configuration. ONLYOFFICE
has no public hostname, browser editor or public cache route. Container outbound
handlers map `http://onlyoffice.internal` and `http://templates.internal` to
private container bindings. These are virtual internal origins, not DNS records.
Only conversion/cache reads and expiring signed source downloads are permitted.
The converter's public internet access is disabled. Python retains internet
access for Google and its PostgreSQL connection.

## Environment setup

Use separate staging/production domains, Supabase projects and Google Web OAuth
clients. Cloudflare Containers requires Workers Paid. ONLYOFFICE is pinned to
9.3.1 and uses a separate `standard-2` instance (1 vCPU / 6 GiB); Python uses
`basic`. Measure startup, memory, conversion fidelity and cost in staging. Review
ONLYOFFICE Community's AGPLv3 license for your deployment.

1. Run `deploy/supabase/bootstrap.sql` in the environment's Supabase project.
   Set the application's role password privately. Keep `report_formatter` out
   of Data API exposed schemas; browser users receive no database credentials.
2. Use the **session pooler**, port 5432, with the application role and TLS:
   `postgresql+psycopg://report_formatter_app.PROJECT_REF:PASSWORD@POOLER:5432/postgres?sslmode=require`.
   URL-encode credentials. Use `verify-full`/CA configuration when required.
3. Set the selected frontend environment's custom-domain route in
   `deploy/cloudflare/web/wrangler.jsonc`. Keep alternate URLs disabled and
   `assets.run_worker_first=true`.
4. Register the exact Google callback
   `https://YOUR_HOST/api/auth/google/callback`; see [Google setup](google-sign-in.md).

## Deploy staging

Authenticate Wrangler privately with `npx wrangler login`. From the repository:

```sh
npm run deploy:cloudflare:api -- staging
npx wrangler secret put TEMPLATE_DATABASE_URL --config deploy/cloudflare/backend/wrangler.jsonc --env staging
npx wrangler secret put TEMPLATE_SERVICE_TOKEN --config deploy/cloudflare/backend/wrangler.jsonc --env staging
npx wrangler secret put ONLYOFFICE_JWT_SECRET --config deploy/cloudflare/backend/wrangler.jsonc --env staging
npx wrangler secret put GOOGLE_CLIENT_ID --config deploy/cloudflare/backend/wrangler.jsonc --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --config deploy/cloudflare/backend/wrangler.jsonc --env staging
npx wrangler secret put TEMPLATE_PUBLIC_ORIGIN --config deploy/cloudflare/backend/wrangler.jsonc --env staging
npm run deploy:cloudflare:web -- staging
```

Generate independent service and converter secrets of at least 32 random
characters. The converter secret is shared automatically between Python and its
ONLYOFFICE container. No ONLYOFFICE URL/DNS configuration is required. The public
origin is the frontend HTTPS origin without a trailing slash. Owner/schema values
are in the backend environment config. Cloud mode always requires Google login;
missing settings fail closed. Restart/redeploy existing containers after rotating
secrets. No Tunnel is needed. Repeat with `production` after staging acceptance.

The cloud build uses `vite.cloudflare.config.ts`; ordinary `npm run build` is a
local build. Backend deployment builds both container images. Do not point local
Compose at the production database. Existing local data is not imported: migrate
a backed-up copy into staging with an explicit verified export/import procedure.

## Schema and release control

See [Alembic migrations](database-migrations.md). Initial deployment upgrades the
database before serving traffic. PostgreSQL advisory locking serializes concurrent
startup attempts. For later controlled releases, run migrations administratively
first and set `TEMPLATE_MIGRATE_ON_START=false` on the backend environment.
Deploy compatible application versions after migration. Roll back to a previous
compatible release using its retained source/image/Worker version; no standby
rollback container is needed. Keep a release identifier and restore procedure.

## Sleep, unsaved work and recovery

Containers sleep after 15 minutes without activity and wake on a request. Saved
templates, drafts, images and sessions live in PostgreSQL and survive sleep.
Browser editor state is independent: backend sleep does not reload the tab or
clear typed values/photos. Preview-image tokens are temporary and are regenerated
when expired. A cold start can delay or fail a request; keep the editor open and
retry. A failed save is not a saved draft. There is no automatic save on sleep.
Closing/reloading the browser, a crash, or an expired session followed by reload
can lose unsaved work; save drafts regularly.

ONLYOFFICE cold starts can take longer than Python. Conversion waits for the
converter health check within a bounded interval; an unavailable converter returns
a retryable error rather than switching layout engines. Converter disk/cache is
ephemeral; documents remain in PostgreSQL and failed conversions can be retried.

## Acceptance and operations

Verify real owner/editor/viewer login, unknown-user denial, direct API/download
privacy, origin protection, logout/revocation, uploads/OCR, PDF/Word exports,
ONLYOFFICE signed callbacks, cold-start retries and revision-pinned drafts.
Load-test concurrent preview/conversion/save traffic and establish error/latency,
container-health, database-size and connection monitoring. Set edge rate limits.
Keep callback query strings, cookies, tokens and DB URLs out of logs.

PostgreSQL stores originals, backgrounds, images and revisions; Supabase Storage
is not integrated. Plan storage/egress and backups accordingly. Configure backups
and verify restore to a separate database; check your provider plan's retention,
PITR and inactivity limits. Draft trash retains documents for 30 days, with cleanup
on startup/list/hourly while awake; strict scheduled purge needs a separate job.
Backups may retain data after application deletion. Cloudflare, Google and Supabase
process hosted/proxied data. Patch the frontend, Python and converter images.
