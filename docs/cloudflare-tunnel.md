# HTTPS access to the local application

A named Cloudflare Tunnel exposes the local application over HTTPS. The frontend,
Python, PostgreSQL and ONLYOFFICE still run on your computer. The computer and
Docker must stay online; this is separate from cloud hosting.

1. Configure a Cloudflare domain and remotely managed tunnel. Keep its token private.
2. Route `^/api(/.*)?$` to `http://template-service:8000`, followed by the catch-all
   to `http://word-gateway:8080`. Do not expose PostgreSQL or ONLYOFFICE.
3. Create a Google Web OAuth client with the exact callback
   `https://YOUR_HOST/api/auth/google/callback` per [Google setup](google-sign-in.md).
4. Copy `.env.tunnel.example` to `.env.tunnel` if absent. Set the tunnel token,
   Google client credentials, owner email and public HTTPS origin. Preserve the
   database password already configured in `.env`.
5. Run `npm run dev:tunnel`. This enables application Google authentication.
6. Verify owner/editor/viewer login, unknown-user denial, private downloads,
   revocation and document workflows before using real records.

Python owns Google identity, sessions and grants. No proxy identity header grants
access. ONLYOFFICE remains a private server-side converter. Cloudflare processes
proxied traffic; this is not provider-excluding encryption.

Stop the connector before switching to local no-login development:

```sh
docker compose --env-file .env --env-file .env.tunnel -f compose.yaml -f compose.tunnel.yaml stop cloudflared
```

Then recreate `template-service` and `web` with the intended local settings.
Never delete the database volume. See [temporary testing](quick-https-testing.md)
for short-lived test URLs, or [cloud deployment](cloudflare-deployment.md) for
hosting independent of your computer.
