# Application-managed Google sign-in

Google authenticates the user; Python validates that identity, checks the local
approved-email list, and issues a database-backed login session. A domain, Tunnel or cloud hosting is not needed to
test real Google login on localhost. No Google credentials have been created
or configured by these code changes.

## 1. Create a development OAuth client in Google Cloud

1. Create/select a project in Google Cloud Console → Google Auth Platform.
2. Complete Branding/contact details. Choose External audience for personal
   Gmail accounts. Add test users if required for your chosen publishing state.
3. Create an OAuth client of type **Web application**.
4. Register this exact authorized redirect URI:

   ```text
   http://localhost:8001/api/auth/google/callback
   ```

5. This server-side authorization flow does not require a JavaScript origin.
   The browser does not receive the client secret or use a Google JS SDK.
6. Copy the Client ID and Client Secret into your existing ignored `.env`.
   Never share them here or commit them. Keep your database password unchanged.

Only basic `openid email` scopes are requested. No Gmail/Drive data is requested
and no Google access/refresh tokens are retained. For approval by email the app
requires Gmail or a verified Workspace account: Google is not authoritative for
ownership of arbitrary third-party addresses attached to Google accounts.

## 2. Enable real login in local Docker Compose

Add/update these values in `.env` (do not overwrite the file/database password):

```dotenv
TEMPLATE_ACCESS_MODE=google
TEMPLATE_OWNER_EMAIL=bry.io456@gmail.com
TEMPLATE_PUBLIC_ORIGIN=http://localhost:5173
TEMPLATE_AUTH_ORIGIN=http://localhost:8001
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
```

From the repository root:

```bash
docker compose up --build -d
docker compose ps
```

Open **http://localhost:5173**, choose **Sign in with Google**, and select the
owner's account. Use `localhost` consistently, not `127.0.0.1`, `0.0.0.0` or your
Wi-Fi IP: cookies and Google redirect matching depend on the hostname. Python
receives the callback on 8001, sets a host-only cookie, and redirects to 5173.
Signed-out visits open the dedicated `/login` page. Simply being signed out is
not an error; failed Google login, approval-required and unavailable-service
states have separate messages. Signed-in visits to `/login` return to the library.
Browser API requests include credentials and CORS allows only that configured
frontend origin in Google mode. Authenticated writes require its Origin too.
HTTP and non-Secure cookies are allowed only for explicit localhost development.

No-login development remains available via `TEMPLATE_ACCESS_MODE=local` and
`docker compose up -d --force-recreate template-service`. This is an explicit
loopback-only development mode, never a production fallback. Stop every public
tunnel before switching to it. Cloud environments reject local authentication.

## 3. Manage the company allow-list

The owner opens **Manage access** (`/access`), enters another account's exact
email and grants Viewer or Editor. Google login never registers an account or
automatically grants access. Unknown accounts see an approval-required message.

- Owner: the configured email; can manage grants and edit documents.
- Editor: can create/edit/delete templates and reports, not manage grants.
- Viewer: can read/download saved content, not save/delete or read draft trash.

Roles apply to the entire application, not individual documents. Each data
request rechecks the grant. Revocation deletes that member's sessions; regranting
does not revive an old cookie. The owner is not editable/removable from the UI.
Role changes take effect on the next request. Changing owner email requires a
backend restart. Downloaded files cannot be revoked. No invitation email is sent.

## 4. Sessions and safety

Authlib handles the authorization-code/PKCE exchange. Python verifies the Google
ID token's signature, fixed issuer/audience, expiration, nonce and verified email.
Ten-minute OAuth transactions are browser-bound and consumed atomically once.
Session cookies are random opaque values; only SHA-256 hashes are stored in
PostgreSQL. Sessions expire after eight hours, survive backend restarts, and are
deleted on logout. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS.
Logout is a POST with origin protection and signs out of this app, not Google.
CSRF origin checks also protect all other authenticated writes.

The additive tables `application_login_attempts` and `application_sessions` are
created on startup without changing existing documents or grants. Expired rows
are pruned when a new login starts. Login attempts temporarily contain the PKCE
verifier/nonce; restrict DB access and include auth tables in private-schema rules.
Callback query strings are redacted from Uvicorn access logs. Other external
proxies/log sinks must also avoid recording callback query parameters.

## 5. Production and tunnels

Use a separate Google OAuth client for production. Set both public/auth origins
to the same public HTTPS origin (omit TEMPLATE_AUTH_ORIGIN on cloud deployment).
Register `https://YOUR_HOST/api/auth/google/callback` in Google, with no wildcard.
Put Google credentials in backend secret settings only.

The frontend Worker proxies cookies/redirects and `/api` to Python; its private
backend service token is a transport credential, not a user identity. CORS is
not authentication. The public application shell/assets contain no saved reports;
all saved data, images, thumbnails and downloads require a session and grant.
See [cloud setup](cloudflare-deployment.md) or [named Tunnel](cloudflare-tunnel.md).

## Verify before using real records

Test owner login, approved Viewer/Editor login, unapproved denial, role changes,
revocation, logout, browser restart, expired sessions, direct API access, upload,
preview and PDF/Word downloads. Google client configuration and live provider
interaction cannot be proven by offline tests. Local tests sign real ID tokens
with test keys and mock only Google network requests. No live Google login has
been claimed. On `redirect_uri_mismatch`, compare Google's URI to the exact URL
including scheme, host, port and path. No-login mode intentionally hides login.

Sources: [Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect),
[Authlib PKCE](https://docs.authlib.org/en/stable/oauth2/client/http/index.html),
[Google-authoritative email](https://developers.google.com/identity/sign-in/android/backend-auth).
