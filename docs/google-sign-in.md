# Google sign-in and administrator-approved access

This prepares the code/configuration; it does not create Google/Cloudflare
resources or activate a public deployment. Local `docker compose up` still uses
no-login development. **Never expose that development mode as production.**

## What runs where

```text
Browser → Cloudflare Access → Google sign-in → signed Access identity
  → frontend Worker → Python /api/access/me → PostgreSQL allow-list
       approved owner/editor/viewer → app
       unapproved account → 403, no application pages/data
```

Cloudflare handles OAuth redirects, Google credentials and login cookies. The
formatter does not receive your Google password or read/send Gmail messages.
No Gmail API or separate Google SDK is needed in this app. This configuration
uses the consumer **Google** provider; a Google Workspace subscription is not
required. Sign-in is not the same as authorization: the private database owns
the list of approved accounts.

The configured administrator is **bry.io456@gmail.com**, set as
`TEMPLATE_OWNER_EMAIL` for staging and production in
`deploy/cloudflare/backend/wrangler.jsonc`. The internal role is called `owner`.
It is configuration, not a password, and is deliberately not editable in the UI.
Do not grant this person Cloudflare/Google Cloud account administration merely
to let them manage application users; those are separate responsibilities.

## 1. Domain and Cloudflare Access

Use a domain/hostname you control, for example `reports.example.com`, proxied
through your Cloudflare account. Create a Zero Trust team and note the team
domain, for example `my-team.cloudflareaccess.com`.

Protect the **whole hostname**, including `/api`, downloads, uploaded images,
OCR/PDF assets and `/access`, with one self-hosted Access application. Do not
create bypass/public exceptions or enable alternate workers.dev/preview URLs.
Use separate hostnames/Access applications for staging and production.

## 2. Configure Google as the identity provider

In Google Cloud Console / Google Auth Platform:

1. Create/select a project and complete branding/contact details.
2. Select **External** audience for ordinary Gmail accounts, not Workspace-only
   Internal. Configure publishing/test users as required by your selected OAuth
   scopes and Google's current consent-screen rules. Basic identity-only apps
   have different testing rules from apps requesting Gmail/Drive access; do not
   use Google's test-user list as the formatter's authorization database.
3. Create an OAuth client with application type **Web application**.
4. Authorized JavaScript origin:

   ```text
   https://my-team.cloudflareaccess.com
   ```

5. Authorized redirect URI:

   ```text
   https://my-team.cloudflareaccess.com/cdn-cgi/access/callback
   ```

6. Keep the Client ID and Client Secret. Put them in Cloudflare Zero Trust →
   Integrations → Identity providers → Add → **Google**. Enable PKCE if offered.
   Use Cloudflare's provider Test action and sign in as the administrator.

The callback belongs to Cloudflare, **not** to a new `/api/auth/callback` in this
app. The Google Client Secret belongs in Cloudflare's identity-provider settings,
not this repository, a browser bundle or `NEXT_PUBLIC_*` variable.

## 3. Let the application administrator manage the allow-list

For the Access application, select only your Google login method (disable
Accept all identity providers). Create an **Allow** policy with:

| Setting | Value |
| --- | --- |
| Action | Allow, never Bypass |
| Include selector | Login Methods |
| Value | The Google provider configured above |

This intentionally admits authenticated Google identities to the application
authorization gate. **It is safe only with the app's membership checks enabled**:
the Worker refuses pages/assets until Python confirms an owner/editor/viewer
grant, and Python checks every data request. Without those checks, this policy
would admit any Google account. Do not replace it with Everyone/Bypass.

With this model, do not maintain a second exact-email Allow list in Cloudflare.
If you choose a stricter exact-email policy instead, users must be approved in
both places; the app cannot override a Cloudflare denial. Other Block policies,
provider restrictions, seat limits and Google consent rules may also deny login.
Cloudflare API credentials are not stored in the formatter or needed by its admin.
Authenticated but unapproved visitors may count towards Cloudflare Access usage;
review the plan's current user/seat limits before broad public sharing.

## 4. Fill the deployment settings

For the Workers/Containers + Supabase path, set these in
`deploy/cloudflare/web/wrangler.jsonc` for each environment:

```json
"routes": [{ "pattern": "reports.example.com", "custom_domain": true }],
"vars": {
  "ACCESS_TEAM_DOMAIN": "my-team.cloudflareaccess.com",
  "ACCESS_AUD": "COPY_THE_64_CHARACTER_ACCESS_APPLICATION_AUD"
}
```

Keep `workers_dev` and `preview_urls` false. Keep the backend private, with no
public routes. `assets.run_worker_first` must stay true so assets cannot bypass
the web gateway. `TEMPLATE_OWNER_EMAIL` is already set on both backend environment
configs. Changing it later requires a backend deployment/container refresh;
existing grants remain in the database.

Deploy the staging backend first so that its Worker exists. This requires your
Cloudflare account, hosting prerequisites and Docker from the deployment guide:

```bash
npm run deploy:cloudflare:api -- staging
```

Then set backend Worker secrets interactively (repeat with `--env production`):

```bash
npx wrangler secret put TEMPLATE_DATABASE_URL --config deploy/cloudflare/backend/wrangler.jsonc --env staging
npx wrangler secret put TEMPLATE_SERVICE_TOKEN --config deploy/cloudflare/backend/wrangler.jsonc --env staging
```

Use the TLS Supabase SQLAlchemy URL and a random service token of at least 32
characters from the [deployment guide](cloudflare-deployment.md). Never put them
in public frontend variables. The owner email is a regular backend config value,
not a third secret. If an earlier deployment stored `TEMPLATE_OWNER_EMAIL` as a
Worker secret, remove that old secret deliberately before deploying the same
name as a variable; do not delete unrelated secrets.

After setting the secrets, deploy the staging frontend:

```bash
npm run deploy:cloudflare:web -- staging
```

The [full deployment guide](cloudflare-deployment.md) covers database preparation,
billing prerequisites and environment isolation. No live accounts, DNS records,
OAuth clients or policies are created by the repository changes alone.

If instead the app stays on a laptop/VM behind a **named Tunnel**, use
[the tunnel guide](cloudflare-tunnel.md), set `TEMPLATE_OWNER_EMAIL` to the same
administrator email in private `.env.tunnel`, and configure the Google policy
above. Python validates the signed Access JWT; the UI blocks rendering without
membership. The cloud frontend Worker check applies only to Worker deployment.

## 5. Use Manage access

Open the public hostname and complete Google sign-in as `bry.io456@gmail.com`.
Open **Manage access** (`/access`), enter the exact Google account email, and grant:

- **Viewer**: view templates and saved reports; download reports; no writes.
- **Editor**: create/edit/delete all templates and reports; no access management.

The owner can change roles or revoke access. Revocation is checked on the next
request; there is no automatic invitation email. Use the canonical email Google
reports for that account, not a guessed Gmail alias. Grants are stored in the
existing `application_users` table and must be included in backups. Sharing is
application-wide, not per report. Downloaded files cannot be revoked.

The app's **Sign out** link ends the Cloudflare Access session; it does not sign
you out of Google itself. Cloudflare may provide SSO again using an active
Google session. Its logout may also affect other applications in the same team.

## 6. Verify before production

Use separate browser profiles for owner, approved viewer/editor, and unapproved
Google accounts. Verify the owner can grant/revoke, non-owners cannot administer,
viewers cannot write even via direct API requests, and revocation denies a still
signed-in account. Check root, deep links, assets, previews, image uploads and
PDF/Word downloads. Test anonymous redirects to Google via Access and invalid
token rejection. Confirm no alternative public origin bypasses Access.

The code has offline JWT/role tests, Worker gate tests and browser UI tests.
They cannot prove your live DNS, Google OAuth consent, Cloudflare policies,
Supabase permissions or logout behaviour. Those require the real configuration.

Local development and public Quick Tunnel testing remain distinct: the latter
can still be configured with **no login**, and is NOT the production login path.
Stop it with `npm run dev:quick:stop` before publishing real documents.

Engineering trade-off: membership is checked against Python/PostgreSQL before
each hosted page/asset render, with no grant cache. This makes revocation prompt
but adds backend/DB requests and means backend downtime blocks the UI too.

Sources: [Cloudflare Google provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/),
[Access policies/selectors](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/),
[Google OAuth publishing states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview),
[Cloudflare session/logout](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).
