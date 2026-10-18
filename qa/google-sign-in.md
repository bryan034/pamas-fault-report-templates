# Google identity + app administrator grants — 18 October 2026

## Scope

Cloudflare Access is the Google OAuth client/session layer. The existing Python
owner/editor/viewer authorization and `application_users` table remain the app's
allow-list. This change does not create OAuth clients, policies, cloud accounts,
DNS entries or production databases, and does not add Gmail API permissions.

## Changes

- Set `TEMPLATE_OWNER_EMAIL=bry.io456@gmail.com` in both backend Worker
  environment configs and the named-Tunnel example. This bootstraps the owner
  from verified identity, not from a client-side role or email form.
- Hosted Worker now checks the private backend's `/api/access/me` before pages
  and assets render. A valid Access JWT alone is insufficient. Invalid/denied
  membership or a failed service lookup cannot fall back to frontend rendering.
- Membership is not cached at the edge, allowing next-request revocation. This
  costs a backend lookup per non-API request and makes backend availability a
  prerequisite for rendering the hosted UI. APIs retain their existing checks.
- Frontend hides children while access is unknown/denied, displays the backend's
  permission explanation, and offers Access sign-out in protected mode.
- Manage access explains the Google-only policy plus database allow-list model.
  It does not synchronize Cloudflare policies or send invitation emails.
- Local no-login Compose and Quick Tunnel test modes remain separate. No public
  test connector was started as part of this security preparation.

## Verification

- `npm run test:deployment`: 10 passing cases, including actual offline JWT
  signature/claim validation, unapproved/revoked membership, page/asset gating,
  malformed membership, backend failures and proxy header stripping.
- `npm run test:access`: 2 passing local/named-tunnel configuration cases.
- `uv run python -m pytest tests/test_application_access.py -q`: 29 passing
  signed-identity, owner/grant/revoke, viewer-write, CSRF and private-token cases.
- Playwright application-access and direct-editing specs: 11 passing UI cases,
  using a temporary SQLite database. UI identities are mocked; these are not
  end-to-end Google login tests. Signed credentials are tested separately.
- TypeScript and targeted ESLint checks are part of this change's validation.
- Local and staging Cloudflare builds both compile. The cloud build is a
  local artifact check, not a deployment or a verified Google OAuth flow.

Actual OAuth consent, cookies/logout, Google account selection, edge policies,
DNS, alternate-origin protection and live Supabase permissions must be verified
on a configured staging hostname before production. No 100% security/coverage
or real Google login verification is claimed.

Setup: [Google sign-in](../docs/google-sign-in.md),
[Cloud deployment](../docs/cloudflare-deployment.md),
[Named Tunnel alternative](../docs/cloudflare-tunnel.md).
