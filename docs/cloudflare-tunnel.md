# Protected multi-device access: Cloudflare Tunnel + Access

The app still runs in Docker on your laptop. Cloudflare provides the public
HTTPS entry and email login, not the computer running your app. Your laptop,
Docker and internet connection must remain on. No teammate needs Docker or a
local CA certificate. This does not move the database to Supabase.

```text
Browser → public HTTPS + Cloudflare Access → outbound cloudflared tunnel
  /api/* → template-service:8000 → existing template-db volume
  everything else → web:8787
```

## 1. Prepare your Cloudflare account and hostname

Use a domain you control, with its DNS active in Cloudflare, and choose a
hostname such as `reports-dev.yourdomain.com`. A domain may have its own cost.
Create a Cloudflare Zero Trust team. The Cloudflare account administrator
controls Tunnel and Access policies; teammates do not need Cloudflare admin
accounts. Keep MFA enabled on that administrator account.

## 2. Configure email sign-in before exposing the app

For **Google sign-in with administrator-managed membership**, use
[Google sign-in setup](google-sign-in.md) for the identity provider and Access
policy. Use **Allow → Include Login Methods → Google**, select Google only,
and let the app's owner-managed grants authorize members. Continue with the
tunnel routing/configuration below. The exact-email/PIN instructions in this
section describe an alternative stricter two-list workflow, not a requirement
to update Cloudflare for every app grant in the Google-only setup.

In Zero Trust, add **One-time PIN** under identity-provider integrations. This
lets approved users receive login codes by email without Google/Microsoft work
accounts. Then go to **Access controls → Applications → Create new application**
and create a **Self-hosted** application (the current UI may group this under
“Self-hosted and private applications”). Add the chosen public hostname.

Protect the **entire hostname**, not just `/` or one report path: APIs, uploads,
downloads, assets and `/access` must be covered. Create an **Allow** policy using
explicit approved email addresses, initially including the owner email. Select
One-time PIN as the login method. Do not use Everyone or a Bypass policy.
Record the Access **team domain** (`your-team.cloudflareaccess.com`) and the
application **AUD** (64 lowercase hexadecimal characters).

## 3. Create the tunnel and configure both routes

In the Zero Trust dashboard, create a remotely managed **Cloudflared** tunnel
(under Networks/Connectors/Tunnels, depending on the dashboard version).
Name it for this laptop/application. Obtain the tunnel token from its connector
installation instructions; copy only the token, not the entire Docker command.
It is a secret, not the tunnel ID or a general Cloudflare API key.

Add these published application routes **on the same hostname**, in this order:

| Hostname | Path | Type | Service |
| --- | --- | --- | --- |
| `reports-dev.yourdomain.com` | `^/api(/.*)?$` | HTTP | `template-service:8000` |
| `reports-dev.yourdomain.com` | leave blank | HTTP | `web:8787` |

API route first, catch-all second. Do not strip `/api` or point the connector at
`localhost:5173`: inside its container, localhost means cloudflared itself.
Docker service DNS names reach the other containers. No router port forwarding
or inbound firewall port is needed. Cloudflare supplies the browser's publicly
trusted HTTPS certificate; the services inside Docker still use HTTP.

For each route, enable **Protect with Access** / Access JWT validation in its
additional application settings and select your team/application. Where the UI
requires it, the corresponding tunnel origin settings are
`access.required=true`, `access.teamName=your-team`, and `access.audTag=[AUD]`.
This is additional to the Access application's Allow policy. The Python API
independently verifies signed JWTs as well; an unverified email header is never
accepted. If the connector is not started yet, the route can show as inactive.

## 4. Fill in local secrets

From the repository root, create the files only if they do not already exist:

```bash
cp .env.example .env
cp .env.tunnel.example .env.tunnel
chmod 600 .env .env.tunnel
```

Do **not** overwrite your existing `.env` or change its database password merely
to enable a tunnel. `.env` retains `FAULT_REPORT_DB_PASSWORD`. Fill `.env.tunnel`:

```dotenv
TUNNEL_TOKEN=your_connector_token
TEMPLATE_OWNER_EMAIL=your_main_account_email
ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
ACCESS_AUD=your_64_character_application_audience
TEMPLATE_PUBLIC_ORIGIN=https://reports-dev.yourdomain.com
```

Use your real values, no URL path/trailing slash on the origin. Owner email must
match the email you use for Access sign-in. These placeholders are not valid
credentials. `.env.tunnel` is git-ignored; only the empty example is tracked.
Never paste tokens, a real rendered Compose config, or environment dumps into
Git/screenshots/logs. The tunnel token is passed only to cloudflared, not the web
or Python service. Docker administrators can inspect container environments;
treat access to your laptop/Docker daemon as administrative access.

## 5. Start the protected stack

```bash
npm run dev:tunnel
docker compose ps
```

This builds/starts the usual three services plus cloudflared, with Python in
protected mode. Check the connector in the dashboard or inspect its logs:

```bash
docker compose --env-file .env --env-file .env.tunnel -f compose.yaml -f compose.tunnel.yaml logs --tail=50 cloudflared
```

Open the **public HTTPS hostname**, not the laptop IP or local HTTP URL. Sign in
with the owner email. In protected mode local API data requests without an
Access JWT are intentionally denied, even on localhost; `/api/health` remains a
non-sensitive local health check for Docker. Do not disable authentication to
work around a failed sign-in.

## 6. Grant users application-wide roles

As the owner, open **Manage access** (`/access`). Add an email and choose:

- **Editor:** create/edit/delete all templates and reports; no access management.
- **Viewer:** browse templates and view/download saved reports; no writes.

The owner is derived from `TEMPLATE_OWNER_EMAIL`, not a user-editable database
grant, and cannot be removed or demoted in this page. Change the environment and
recreate the service if ownership must change.

There are **two gates**: identity must satisfy the Cloudflare Access Allow
policy from step 2, then the app checks its grant. A Google-only login-method
policy requires no per-email Cloudflare edit. If you instead choose the stricter
exact-email policy, update both lists. This page does not modify that policy.
Users allowed by Cloudflare but not assigned an application role are denied.
Revoking a grant takes effect on the next API request, even if their Access
session is still valid. Previously downloaded documents cannot be revoked.
All documents are shared at application level; there is no per-document sharing.

Grants live in the additive PostgreSQL `application_users` table, alongside
existing content. Ordinary restarts preserve them. Include the table in backups.
The table records who last updated each grant, not a complete audit history.

## 7. Test before sharing real documents

Use disposable reports and separate browser profiles/accounts:

1. Owner can grant/change/revoke roles, and cannot delete the configured owner.
2. Editor can save reports and templates but cannot change grants.
3. Viewer sees “View draft”, downloads PDF/Word/original, and cannot save/delete
   even by sending a write request directly to the API (403).
4. An unapproved email is blocked by Access; an Access-admitted but unassigned
   email is blocked by the app. Revoke an assigned account and retry a request.
5. Check field creation, OCR/image upload, preview, save and downloads on a phone
   and another computer. Confirm frontend and API share the same HTTPS hostname.

The checked-in offline tests verify signatures, permissions and routing config.
They do not prove your actual dashboard policy/DNS/token configuration works.
The tunnel was not activated just by changing this repository.

## 8. Stop remote access or return to laptop-only development

Stop the connector with the same environment/Compose files:

```bash
docker compose --env-file .env --env-file .env.tunnel -f compose.yaml -f compose.tunnel.yaml stop cloudflared
```

Then restore the unauthenticated **loopback-only** development services:

```bash
docker compose up -d --force-recreate template-service web
```

Open `http://localhost:5173`. Never leave a connector routing to the API while
switching it back to unauthenticated mode. The default base configuration omits
the connector deliberately. The connector also uses a separate Docker network:
recreating the web/API from the base file disconnects them from that network,
so a forgotten connector cannot simply reach the unauthenticated services.
Do not run `docker compose down -v`; that deletes
the database volume. For permanent withdrawal also remove the public routes or
disable the tunnel in Cloudflare. Rotate a leaked tunnel token in Cloudflare.

## Retired local certificate setup

Caddy, its Compose service, setup scripts and local CA generation are removed.
An older running stack may still have an orphaned HTTPS container. Inspect
`docker ps -a` and stop/remove only that exact old `...-https-1` container before
starting the new web container on 5173. Never remove the `template-postgres`
volume. Retired `..._local-https-data` and `..._local-https-config` volumes can be
removed after verifying they belong only to the retired HTTPS service.

If you manually trusted the previous local CA, removing Caddy does not undo
that OS setting. You may remove that specific old Caddy root from Keychain
Access (or the equivalent device trust store); do not remove unrelated roots.
No trust-store changes are made by this application.

## Security and hosting limits

Cloudflare terminates/proxies HTTPS and can process the traffic. This is not
end-to-end encryption that excludes Cloudflare. The private data remains in
your local database, but documents traverse Cloudflare when shared this way.
Local development has no login; it is not a production security model. Access
does not provide backups, laptop uptime or per-document permissions. For true
cloud hosting use the separate [Workers/Containers + Supabase guide](cloudflare-deployment.md).

Sources: [Access application setup](https://developers.cloudflare.com/learning-paths/clientless-access/access-application/create-access-app/),
[email one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/),
[tunnel ingress ordering and path forwarding](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/),
[connector token environment variable](https://developers.cloudflare.com/tunnel/reference/run-parameters/).
