# Cloudflare + Supabase deployment

This adds a deployment path, not an already-deployed application. No cloud
resources, accounts, paid subscriptions, secrets or production data are created
by editing this repository. Start with staging and test it before production.

## Architecture

```text
Team browser
  -> HTTPS custom domain + Cloudflare Access Google sign-in
  -> Vinext frontend Worker (also verifies the signed Access JWT)
       -> frontend/static assets
       -> /api/* -> private service binding -> backend gateway Worker
                       -> one Python container -> Supabase PostgreSQL
```

The backend gateway has no public routes, workers.dev URL, or preview URL.
The frontend also disables workers.dev/preview URLs; only your configured custom
domain is intended to be reachable. Every request, including static assets,
passes the frontend's authentication and app-membership checks (`assets.run_worker_first`).
The gateway passes a separate secret token to Python; Python rejects requests
without it in staging/production. CORS is not used as authentication.

Both environments are shared-team workspaces with application-wide roles:
Owner manages grants, Editor can change all templates/reports, and Viewer can
browse/download saved reports. `TEMPLATE_OWNER_EMAIL` is set to `bry.io456@gmail.com`
in the backend Worker configs; the owner manages roles at `/access`. Access
admission alone is not an app grant. There is no per-document sharing or complete
activity audit trail. Follow [Google sign-in setup](google-sign-in.md), including
the Google-only Access policy and live-account security tests.

The local `compose.yaml`, local PostgreSQL volume and `npm start` remain a separate
development workflow. Optional protected Tunnel setup is described below. Do not change local
`.env` to the production DB URL.
The original `vite.config.ts` and its local preview helpers are not used by the
cloud build. The cloud config does not load mock authentication.

## Requirements and cost

- Cloudflare account with **Workers Paid** enabled for Containers (currently a
  US$5/month base plus usage; not a fixed total bill). Access has a separate
  Free plan for small teams. Verify current limits/prices before subscribing.
- A domain managed in your Cloudflare account, with separate hostnames, for
  example `reports-staging.example.com` and `reports.example.com`.
- Supabase projects for staging and production. Separate projects provide
  stronger isolation than two schemas in one database. Choose nearby regions
  and review project quotas, backups and inactivity behaviour for your plan.
- Node 22.13+, npm, and Docker running on the deployment computer (or CI).
  Images must support `linux/amd64`; Wrangler builds the container image and
  pushes it to Cloudflare's registry. Teammates need only a browser/email.

No Tunnel is necessary: both application components run on Cloudflare.
No D1, R2, Docker Hub, Microsoft 365 or Google Workspace account is required.

## 1. Prepare Supabase (repeat for each environment)

1. Create a Supabase project. Keep staging and production credentials separate.
2. Open **SQL Editor** and execute `deploy/supabase/bootstrap.sql` from this
   repository. It creates the private `report_formatter` schema and a dedicated
   `report_formatter_app` login role without superuser/database-creation rights.
   Existing local data is not touched or imported.
3. Give the app role a strong unique password, using a one-off SQL Editor query:

   ```sql
   ALTER ROLE report_formatter_app PASSWORD 'YOUR_NEW_RANDOM_PASSWORD';
   ```

   Do not put that actual password into the committed SQL file. Escape SQL quotes
   correctly or use a generated URL-safe password. Use a different one per env.
4. In **Connect**, select the **Session pooler**, port **5432**, database
   `postgres`. Use the actual hostname/user format from your project. For a
   custom role the pooler username is `report_formatter_app.PROJECT_REF`.
   Session mode is the intended setup here, not transaction pooler port 6543.
5. Construct the server-side SQLAlchemy URL:

   ```text
   postgresql+psycopg://report_formatter_app.PROJECT_REF:URL_ENCODED_PASSWORD@YOUR_SESSION_POOLER_HOST:5432/postgres?sslmode=require
   ```

   Percent-encode reserved password characters (such as `@`, `:`, `/`, `#`, `%`).
   `sslmode=require` encrypts transport; use certificate verification
   (`verify-full` with the proper CA setup) if your security policy requires it.
   This is a database connection string, not a Supabase HTTP project URL or API
   key. Do not use a `NEXT_PUBLIC_*` variable for it.
6. Leave `report_formatter` **out of the Data API's exposed schemas**. If this
   project is used only by this Python service, disable the Data API in its
   API settings. The app connects directly over PostgreSQL; it does not need
   Supabase's browser Data API. Never expose the app schema by adding it to
   exposed schemas or granting `anon`/`authenticated` access.

The backend qualifies its tables using `schema_translate_map`; it does not need
pooler startup `search_path` options. It creates missing app tables at startup
with a bounded pool (3 steady connections + 2 overflow per Python process).
It uses `pool_pre_ping` and recycles connections after 300 seconds. These checks
do not provide general migrations or eliminate all transient DB failures.

### What gets stored

The current data model is preserved: template PDFs, thumbnails, revisions, draft
values, shapes and uploaded image bytes all live in PostgreSQL in that private
schema. Supabase **Storage is not integrated by this change**. You do not need
a bucket or public storage credentials. Generated downloads are returned to the
browser, not automatically retained as separate PDF files in a bucket.

This avoids changing existing draft/image semantics, but binary PDFs/images and
revision copies consume database space. Monitor Supabase database quotas; moving
large assets to private object storage is a separate future migration.

## 2. Configure Cloudflare Access before exposing a hostname

1. Enable Zero Trust/Access in Cloudflare and select a team name, for example
   `your-team.cloudflareaccess.com`.
2. Configure the consumer **Google** identity provider using the Client ID/Secret
   from Google Auth Platform, following [Google sign-in setup](google-sign-in.md).
   This works with ordinary Google accounts, without Workspace.
3. Add a **Self-hosted application** covering the ENTIRE staging hostname
   `reports-staging.example.com` (all paths, not just `/` or `/templates`).
4. Select Google only for application login and add an **Allow** policy with
   **Include → Login Methods → your Google provider**. This verifies identity;
   the app's database grants decide membership. An unapproved Google account
   receives 403 from the app. Do not use Everyone, Bypass or public exceptions
   for `/api`, downloads, OCR assets or PDF workers. A separate exact-email
   Cloudflare policy is optional, but then every member needs approval there too.
5. Copy the application's **AUD/Application Audience** value. Repeat with a
   separate Access application/AUD for the production hostname.
6. Configure session lifetime to suit your team. Revoking an email prevents
   future access, but to immediately invalidate an existing session also revoke
   that user's active Access sessions.

Edit the selected environment in `deploy/cloudflare/web/wrangler.jsonc`:

```json
"routes": [{ "pattern": "reports-staging.example.com", "custom_domain": true }],
"vars": {
  "ACCESS_TEAM_DOMAIN": "your-team.cloudflareaccess.com",
  "ACCESS_AUD": "YOUR_64_CHARACTER_APPLICATION_AUD"
}
```

Use your real hostname and AUD; do not copy these placeholders. These are
non-secret deployment identifiers and may be committed. Keep `workers_dev` and
`preview_urls` false. Do not add a public backend route. Worker JWT verification
fails closed if Access settings are absent/wrong, including if someone disables
Access accidentally. Access policies determine which emails receive valid
tokens; the app verifies signature, issuer, audience, expiry and user claims.

The deploy script refuses to publish the frontend until its domain and Access
settings have been supplied. Cloudflare may prompt about DNS conflicts when
attaching the custom domain; inspect existing records first rather than replacing
an unrelated live service.

## 3. Deploy staging backend and set its secrets

From the repository root:

```bash
npm ci
npx wrangler login
npx wrangler whoami
npm run deploy:cloudflare:api -- staging
```

If your account has several accounts, select the correct one or set
`CLOUDFLARE_ACCOUNT_ID` in your deployment shell/CI. The first command that
actually deploys requires authentication, a paid Workers plan and Docker. This
is not run automatically by `npm run build` or local Compose.

Set these two **backend Worker secrets** interactively; Wrangler prompts for
each value so you do not place it in a tracked file or command argument:

```bash
npx wrangler secret put TEMPLATE_DATABASE_URL --config deploy/cloudflare/backend/wrangler.jsonc --env staging
npx wrangler secret put TEMPLATE_SERVICE_TOKEN --config deploy/cloudflare/backend/wrangler.jsonc --env staging
```

For `TEMPLATE_DATABASE_URL`, paste the staging Supabase URL from step 1.
For `TEMPLATE_SERVICE_TOKEN`, use a separate password-manager-generated random
secret of at least 32 characters (prefer 64). It is NOT the database password
or a Supabase API key. The gateway explicitly passes these settings into the
container at startup, and injects the service token into API requests.

`TEMPLATE_OWNER_EMAIL` is already configured as `bry.io456@gmail.com` in both
backend environment configs, as a regular non-secret variable. If an older
deployment used a secret of that same name, deliberately remove the old secret
before deploying it as a variable. The owner grants Editor/Viewer roles from
`/access`, without editing the Google-only policy for each member. The frontend Worker
replaces any caller-supplied identity header with the email from its verified JWT;
Python trusts that header only behind the authenticated private service gateway.

The private backend can be deployed before its secrets are set; it cannot
successfully serve requests until all are valid. The frontend never receives
these secrets. `TEMPLATE_DATABASE_SCHEMA` and `TEMPLATE_ENVIRONMENT` are already
set per environment in the backend config.

No backend public URL is expected. Health is tested later through the
authenticated frontend's `/api/health` route. The Python docs/OpenAPI endpoints
are disabled in cloud mode. First container provisioning may take a few minutes.

## 4. Build and deploy staging frontend

```bash
npm run build:cloudflare -- staging
npm run deploy:cloudflare:web -- staging
```

The deploy command rebuilds before uploading, so the first build-only command
is optional. `vite.cloudflare.config.ts` produces the Vinext Worker and assets.
Wrangler deploys the generated `dist/server/wrangler.json`, not `npm start`.
The build selects same-origin `/api/...` routes regardless of the local API
URL. Its private service binding targets `report-formatter-api-staging`.

Only the frontend has a browser URL. This avoids cross-origin cookie/login
problems. Multipart uploads, streamed responses, PDF filenames and status codes
are passed through; private responses use `Cache-Control: private, no-store`.
Cross-origin write requests are rejected. Cloudflare platform upload/time limits
still apply in addition to the app's PDF/image limits.

Cloud builds and local builds both write `dist/`. If you run `npm start` locally
after a cloud build, rebuild locally with `npm run build` first. Compose builds
its own frontend image using the existing local build command, so the normal
`docker compose up --build -d` workflow is unaffected.

## 5. Staging acceptance checks (required)

Use test documents only. Automated local tests cannot prove that your account,
Access policies, DNS, Supabase role or provider lifecycle are configured correctly.

- Incognito, unapproved email: cannot open ANY app page, image, PDF or API.
- Approved email: OTP login works; `/api/health` returns `{"status":"ok"}`.
- Open browser network tools: API calls go to the same HTTPS hostname, never
  `localhost`, `:8001` or the staging/production backend's public address.
- Upload a multi-page PDF, review fields/covers, save/edit a template, create a
  report, add photos, extract OCR, move/resize fields, draw shapes, save/reopen,
  download a correctly titled PDF, filter drafts, archive/recover, delete a
  disposable draft/template. Check PDF.js worker/WASM assets and photo previews.
- Open the app concurrently in two browsers and ensure saves behave as expected.
  There is no new edit-conflict resolution; last-writer updates remain possible.
- Let the backend idle for more than 15 minutes; then reopen a report/preview.
  Cold starts may take longer. Recheck after a backend redeploy/restart.
- Verify saved reports/photos survive restarts. Preview tokens are intentionally
  temporary; the existing editor reuploads photos when it receives an expired
  token (HTTP 409). A cold-start 503 may require a retry; unsaved edits are not
  durable until saved.
- Confirm both backend workers have NO routes or workers.dev/preview URL and
  the frontend's workers.dev/preview URLs are disabled. Do not create an origin
  hostname that bypasses the Access-protected custom domain.
- Inspect Supabase: app tables are in `report_formatter`, not exposed through
  public Data API access. Test a backup restore into a disposable project.
- Check that staging data does not appear in production and vice versa.

## 6. Production

Repeat Supabase setup with a separate production project. Set the production
frontend hostname, Access AUD and team domain in the web config. Then:

```bash
npm run deploy:cloudflare:api -- production
npx wrangler secret put TEMPLATE_DATABASE_URL --config deploy/cloudflare/backend/wrangler.jsonc --env production
npx wrangler secret put TEMPLATE_SERVICE_TOKEN --config deploy/cloudflare/backend/wrangler.jsonc --env production
npm run deploy:cloudflare:web -- production
```

Use production-only secrets; never point staging or local testing at production.
After release, perform a small approved-user and denied-user smoke test using
disposable records, not destructive testing against real documents. One Git
repository is enough; separate deployment configurations/secrets/data provide
environment separation. Separate repositories are not required.

## Local development stays local

```bash
docker compose up --build -d
```

The local database is still `template-db`, exposed only on localhost:5434. Open
`http://localhost:5173`; web, API and DB ports are all loopback-only. No cloud
account, Supabase URL or Access token is needed for laptop-only development.
For other devices use [Cloudflare Tunnel + Access](cloudflare-tunnel.md), which
keeps the same local data and verifies identities before authorizing API calls.
Existing tests keep their SQLite/disposable PostgreSQL isolation. A tunnel does
not test cloud container restarts, real Supabase permissions or Worker deployment;
use staging for those checks. Do not port-forward local ports to the internet.

## Operations, backups and limitations

- **Costs:** one container instance per env, basic size (1 GiB), idle sleep after
  15 minutes. This is a modest starting point, not a load-tested capacity promise.
  Set billing alerts; memory/disk while active, CPU, requests, egress and both
  staging and production can incur charges. Change size only after measurement.
- **Preview cache:** still bounded process-local memory. The gateway routes to
  a stable named instance with `max_instances: 1`; no random load-balancing.
  Restarts clear it, but saved database data survives. Do not add replicas or
  multiple Uvicorn workers without shared preview storage/session affinity.
- **Persistence:** never save essential files only to container disk. All current
  saved app data is in PostgreSQL. Browser downloads reside on the user's device.
- **Backups:** establish scheduled PostgreSQL backups appropriate to the plan,
  protect off-provider copies where required, and rehearse restore into staging.
  Database maintenance/quotas are still your responsibility on managed hosting.
- **Existing local records:** NOT automatically transferred to Supabase. Back up
  the local `templates` database with `pg_dump` before any migration. Its tables
  are in `public`; cloud uses `report_formatter`, so a plain unmodified restore
  is not a complete migration. Restore only the six app tables into a disposable
  project, move them into the private schema, grant the app role access and
  verify revisions/photos before cutover. Never restore a whole local database
  over Supabase's managed `auth`/`storage` schemas. Plan migration separately if
  you need existing records; do not delete the local Docker volume.
- **Schema changes:** `create_all` adds missing tables; it does not alter existing
  columns. Introduce reviewed migrations before future structural changes. Back
  up before upgrades; code rollback does not roll back database changes.
- **Secrets:** rotate using `wrangler secret put`; restart/redeploy the backend
  to ensure running containers receive new values. Never use Docker build args
  for passwords, or put them in `NEXT_PUBLIC_*`, Git, screenshots or logs.
- **Updates/monitoring:** watch Worker/container errors and Supabase connections,
  usage, quota and backups. Patch dependencies and rebuild images regularly.
  Vinext is currently a beta dependency: validate routes, SSR and downloads in
  staging with every framework/runtime update.
- **Known existing OCR limitation:** the suite marks QA-006 as an expected
  failure: a qualifier can cross into another photo label when several readings
  are on the same OCR line. Always review extracted values. This deployment work
  does not fix that pre-existing behaviour; assess it before relying on OCR for
  real inspection readings.
- **Known existing image-validation limitation:** backend QA-001 is an expected
  failure: a truncated JPEG can pass initial verification and then cause a
  rendering HTTP 500. Use valid photos and assess/fix this before a wider rollout;
  this is not a claim that all existing application defects are resolved.
- **Access:** periodically review the email allowlist, sessions and administrators.
  Keep the application and all downloads behind Access. This is not encryption
  that prevents Cloudflare/Supabase from processing data; assess provider terms,
  residency and company document policies before uploading sensitive files.

## Checks you can run without deploying

```bash
npx tsc --noEmit
npm run test:deployment
npm run test:ocr
node --experimental-strip-types --test tests/template-editing.test.mjs
cd backend
uv run python -m pytest
cd ..
npm run build:cloudflare -- staging
npm run build
```

Do not call these local results proof of a production deployment. See the staging
checklist above for provider-level checks still required.

### Preparation checks recorded on 16 October 2026

- TypeScript check and lint of changed deployment/API files passed.
- Eight deployment/security tests passed; the existing OCR/editing unit tests
  passed (four and five tests respectively).
- Backend suite with SQLite: 94 passed, one PostgreSQL check skipped, one known
  expected failure. With a disposable PostgreSQL 17 instance: 95 passed and the
  same one expected failure. No saved local/cloud database was used.
- Browser suite: 28 completed successfully, including its existing expected-
  failure OCR case. These are local development browser tests, not Access E2E.
- Staging and production Cloudflare frontend builds passed. Frontend and backend
  Wrangler deployment dry runs passed; the backend's Linux/amd64 image built and
  generated a PDF as the non-root user. No image was pushed to a cloud registry.
- The Supabase bootstrap SQL ran against a disposable PostgreSQL instance with
  stand-in `anon`/`authenticated` roles. Those roles could not use the private
  schema; the dedicated app role could create all six app tables. This is not a
  live Supabase pooler/SSL test.
- The normal local frontend build, Compose frontend image build, Compose config
  validation and non-root `uv` startup check passed. The built local frontend
  container also started and returned the app HTML successfully.

Actual Cloudflare/Supabase provisioning, Access OTP/JWT delivery, TLS pooler
connectivity, cold-start handling and production permissions still require the
staging acceptance checks with your own accounts and credentials.

## Supporting documentation

- [Cloudflare Containers setup](https://developers.cloudflare.com/containers/get-started/)
- [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
- [Container lifecycle/persistence](https://developers.cloudflare.com/containers/faq/)
- [Access JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Access email codes](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Workers asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase database roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)
