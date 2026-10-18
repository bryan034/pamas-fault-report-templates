# Cloudflare Tunnel and application access — 17 October 2026

## Implemented

- Removed Caddy's Compose service, scripts, configuration and certificate setup
  guide. Default development is HTTP on loopback `localhost:5173`; API and
  PostgreSQL remain loopback-only. No OS/browser trust store was modified.
- Added optional `compose.tunnel.yaml`, empty `.env.tunnel.example` and
  [setup instructions](../docs/cloudflare-tunnel.md). Missing required settings
  fail configuration rather than silently enabling unauthenticated access.
  The connector uses a separate Docker network to isolate the base dev stack.
- Python verifies Access JWT signature, issuer, audience, required claims and
  expiry for tunnel requests. Its JWKS URL comes from validated configuration.
  Unknown users are denied. The prepared cloud Worker path forwards only the
  verified email and still requires its private service token at Python.
- Application-wide Owner/Editor/Viewer roles; single owner configured by email.
  PostgreSQL grants are checked on each request. Only the owner can manage them.
  Viewers cannot write, including direct API requests, and use a read-only saved
  report viewer with PDF/Word/original-format downloads.
- Owner access page with grant, role change and confirmed revocation. It does
  not call Cloudflare's policy-management API or store account administrator
  credentials. Cloudflare admission and application grants are separate gates.
- Local no-login development cannot manage grants. Existing templates and
  reports are not migrated, deleted or assigned per-document owners.

## Verification

- `uv run python -m pytest -q`: **161 passed, 2 skipped, 1 xfailed** on the local
  interpreter. The new access module has 29 passing cases, including signed
  offline JWTs, forged headers, signature/claim failures, owner bootstrap,
  grant/update/revoke, invalid grants, cross-site writes, Viewer write rejection,
  saved-report reads and downloads, and cloud service-token identity checks.
- Skips: isolated PostgreSQL-specific QA and real LibreOffice conversion were
  not enabled on the host. The expected failure is the existing OCR boundary
  issue. Prior converter checks are recorded in [Word QA](word-templates.md).
- Playwright full regression: **36 passed, 1 skipped**, including its existing
  expected-failure OCR test. Three new access UI tests pass. These simulate roles
  for UI assertions; Python tests separately verify signed identities and API
  authorization. The skipped browser check requires a real Word converter.
  After the access bar's viewport-height adjustment, a further nine access and
  desktop/mobile editor regression checks passed.
- Node entry/UUID/OCR/editing/deployment/tunnel checks: **26 passed**.
- TypeScript no-emit check, local build and staging Worker build passed.
- New/changed access modules pass targeted ESLint. Repository-wide lint is not
  clean: existing image-extraction/resizable-workspace React-rule errors and
  generated OCR/PDF/cache artifacts are outside this change. No whole-repo lint
  success or 100% coverage is claimed.
- Compose tunnel overlay validates with dummy security settings, without
  starting a connector. Local Compose rebuilt and started successfully. HTTP
  localhost and local API identity respond; PostgreSQL created the additive
  `application_users` table. Existing local template/report records remain.

One regression run overlapped client-module formatting/HMR and left an editor
on “Checking access…”. A fresh complete run after edits settled passed,
including preview/upload reuse. Tests were not weakened to conceal that run.

## Retired runtime cleanup

Removed the verified `fault-report-generator-source-https-1` container and
`fault-report-generator-source_local-https-data` / `..._local-https-config`
volumes. Their private CA/configuration data is not recoverable from those
deleted volumes. The active `fault-report-generator-source_template-postgres`
volume was preserved. Exported public root/host files were moved out of the
repository to `/tmp/report-formatter-retired-tls.RfR5bo/local-https` (temporary,
not a durable backup). Old trusted roots, if manually installed, remain an OS
setting for the owner to remove deliberately.

## Still requires real environment testing

No live Tunnel/Access policy, DNS, owner email or connector token was configured.
Test allowed/unapproved/unassigned users, role revocation, same-origin API paths,
phone/browser secure-context features and all downloads on the actual protected
hostname before using real documents. Dashboard configuration, cloud uptime,
Supabase permissions and end-to-end production security are not proven by the
offline tests. Per-document sharing, Cloudflare allowlist synchronization,
complete audit history and production hosting are not added by this change.
