# Free HTTPS testing without a domain

## Public mode (explicit opt-in)

Set `QUICK_TEST_ACCESS=public` in your git-ignored `.env.quick` and run
`npm run dev:quick` without email arguments. This intentionally disables **all**
email authentication, not just the approved-address list. Anyone with the URL
can view, edit and permanently delete your existing testing templates/reports,
including from outside your Wi-Fi. The laptop and database stay local.

The launcher prints `Public HTTPS testing URL (NO LOGIN)` after verifying that
the public API reaches the local app. It uses `compose.quick-public.yaml` to
replace the connector command without `--allowed-mail`. No email identity is
passed to the public connector. Stop with `npm run dev:quick:stop` when finished.

To restore email protection, set `QUICK_TEST_ACCESS=email`, supply real approved
addresses, and restart with `npm run dev:quick`. Email mode remains the default
when no access mode is set. The remaining instructions below describe email mode.

This optional mode reuses your running web/API services and **existing testing
database volume**. It adds two sidecars, not a new database:

```text
Browser → HTTPS + email code at Cloudflare → encrypted tunnel → HTTP router
  /api/* → existing Python service → existing PostgreSQL volume
  other paths → existing frontend
```

Cloudflare terminates browser HTTPS. The router and application still use HTTP
inside Docker. No local CA, device trust changes, domain, Cloudflare account or
paid hosting is needed for Quick Tunnels. Your laptop/Docker must remain on.
The generated hostname changes when you restart the connector. This is for
testing, not production hosting. Cloudflare can process the proxied traffic.

## Important access limitation

The Quick Tunnel email gate controls **who enters**. It does not integrate with
the app's separate Owner/Editor/Viewer roles. This launcher requires the
existing no-login local application mode and never disables configured
authentication. Every approved tester can edit/delete your existing testing
templates and reports. Manage access remains disabled in local mode. Use the
separate [application Google login](google-sign-in.md) workflow if you need
configured roles. It works directly on localhost without a tunnel. For remote
devices use the named-Tunnel setup with a registered HTTPS callback.

## Start

1. Start Docker Desktop and the normal local stack if it is not already running:

   ```bash
   docker compose up --build -d
   ```

   Do not switch an existing domain-protected tunnel back to local mode while
   that connector is still running; stop it using its documented workflow first.

2. Supply an email address you can actually receive a one-time code at:

   ```bash
   npm run dev:quick -- your-real-email@gmail.com
   ```

   Multiple testers:

   ```bash
   npm run dev:quick -- your-real-email@gmail.com colleague@example.com
   ```

   Replace those examples with real approved addresses. `example.gmail.com`
   is a hostname, not an email. A fake mailbox cannot receive the code.

   Alternatively copy `.env.quick.example` to `.env.quick` without overwriting
   an existing file, set `QUICK_TEST_ALLOWED_EMAILS` to comma-separated real
   addresses and run `npm run dev:quick`. That local file is git-ignored. Keep
   the normal `.env` and its database password unchanged.

3. The launcher confirms that existing services are running, verifies local
   application mode, identifies the existing PostgreSQL volume, and checks the
   pinned connector's email-protection flag. It starts only the HTTP router and
   connector, with `--no-deps`; it does not recreate the database or app services.

4. It prints an HTTPS URL **only after** an anonymous API request redirects to
   Cloudflare's Access login. If it cannot verify that redirect, it stops the
   connector. The check allows up to 90 seconds for the new public endpoint to become
   reachable and reports the last HTTP status or network error on failure.
   This is a maximum, not a fixed delay: verification ends immediately on success.
   Provisioning the temporary hostname and starting Docker sidecars are separate
   steps, so the entire startup can take longer than 90 seconds.
   It never retries without the email restriction. First check that
   Cloudflare's actual login sends a code only to the configured addresses.

5. Open that URL on another device, enter an approved email, receive the code,
   and sign in. The internal app may display “Local development — no login”:
   the external email gate, not the application role system, authenticated you.

These commands start a public Internet endpoint, not a Wi-Fi-only endpoint.
Anyone who passes its email gate can access the testing data from outside the
office too. Do not remove the email restriction as a workaround.

## Verify HTTPS browser features

As of 18 October 2026, an [open upstream issue](https://github.com/cloudflare/cloudflared/issues/1752)
reports repeated logins shortly after successful email authentication with
cloudflared 2026.10.0. This has not been reproduced against your app: a real
mailbox and authenticated browser session are still needed. If it happens,
stop the tunnel and investigate the provider issue; do not remove email
protection to work around it. The launcher's anonymous redirect check does
not prove that an authenticated session stays usable.

After signing in and reaching the **application** (not just the login page),
open the browser developer console and run:

```javascript
window.isSecureContext
typeof window.crypto.randomUUID
```

Expected: `true` and `"function"` in supported browsers. Then try adding fields,
uploading a disposable image, OCR, live preview, saving/reopening a test draft,
and PDF/Word downloads. Browser permissions and browser-specific support still
apply; HTTPS does not guarantee every API works automatically.

Also open a private browser session without signing in and visit
`https://YOUR-QUICK-HOST/api/access/me`. It must lead to email login, not return
the app's JSON identity. Try an unapproved mailbox and confirm it cannot enter.
Already downloaded files cannot be revoked.

## Stop

```bash
npm run dev:quick:stop
```

This stops/removes only `quick-tunnel` and `quick-gateway`. It does not remove
the frontend, backend, database, or any PostgreSQL volume. Sidecars have no
automatic restart policy, so Docker restarting does not silently publish a
new testing URL. Never run `down -v` to stop HTTPS testing.

## Files and checks

- `compose.quick-test.yaml`: optional sidecars, loopback-only local router port
  8088; no database or application overrides.
- `deploy/quick-test/nginx.conf`: HTTP routing for UI/API at one public origin.
- `scripts/quick-https.mjs`: launch/stop checks and anonymous login verification.
- `.env.quick.example`: optional empty email configuration.
- `npm run test:quick`: offline configuration, email and redirect tests.

The named-Tunnel command `npm run dev:tunnel` and `.env.tunnel` are a separate
workflow; do not combine both overlays. No public tunnel is activated by adding
these files alone. Email receipt and authenticated device tests need a real
mailbox and browser sign-in; offline tests do not prove them.

Source: [Cloudflare Quick Tunnels and email restrictions](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
