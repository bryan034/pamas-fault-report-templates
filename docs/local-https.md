# Local HTTPS for Wi-Fi testing

Run from the repository root, with Docker Desktop running and the existing
database password configured in `.env`:

```bash
npm run dev:https
```

This detects the laptop's primary private IPv4 address, saves non-secret host settings
under ignored `.local-https/hosts.env`, and runs `docker compose up --build -d`.
To choose a particular interface/address:

```bash
npm run dev:https -- 192.168.0.218
```

Use YOUR current IP, not necessarily this example. On macOS,
`ipconfig getifaddr en0` usually shows Wi-Fi. Rerun the command when the laptop's
IP changes; the CA remains the same as long as its Docker volume is retained.
A DHCP reservation in your router can keep that address stable.

## Addresses and API routing

- Browser: `https://LAPTOP_IP:5173` on the same Wi-Fi, or
  `https://localhost:5173` on the laptop.
- The chosen Wi-Fi IP is also the default certificate for IP clients that omit
  TLS SNI. Use `localhost` (not 127.0.0.1) for loopback after LAN setup. To use a
  different LAN interface, rerun the setup command with that IP explicitly.
- Caddy terminates TLS and forwards `/api/*` to Python, all other requests to
  the frontend. Do not point the browser at `https://LAPTOP_IP:8001`; that is
  not a TLS listener. The frontend selects same-origin API requests on HTTPS.
- HTTP debugging remains loopback-only at `http://localhost:5175`; the direct
  Python API remains loopback-only at `http://localhost:8001`.
- PostgreSQL stays loopback-only at port 5434. No database volume is replaced.
- `docker compose up --build -d` still works after initial HTTPS setup; host
  settings are retained in `.local-https/hosts.env`. Without that file, only
  localhost/127.0.0.1 certificates are configured. Plain `npm run dev` remains
  an HTTP development server; use this Docker workflow for Wi-Fi HTTPS.

## Trust the local CA on EVERY device

Caddy creates a private local certificate authority in the `local-https-data`
Docker volume. The setup command exports only its PUBLIC root certificate to
`.local-https/root.crt`. It does NOT install it into your computer/browser trust
store. Browser security features require a valid, trusted HTTPS connection;
clicking past a certificate warning is not the intended setup.

Only trust this CA on devices you control or administer, and verify it came
from your own laptop. A trusted root can authenticate sites to that device, so
protect its private keys. Never copy/share `root.key`, `intermediate.key`, the
Docker CA volume, or private keys. Only `root.crt` is meant to be shared.

- **macOS:** import `root.crt` into Keychain Access (System or login keychain),
  open it, and set trust for SSL to Always Trust. Alternatively, if you choose
  to grant system-wide trust yourself:

  ```bash
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain .local-https/root.crt
  ```

- **Windows:** import the certificate into Trusted Root Certification
  Authorities for the appropriate user/computer using Certificate Manager.
- **iPhone/iPad:** install the certificate profile, then enable full trust for
  this root under Settings > General > About > Certificate Trust Settings.
- **Android:** use the device's security/credential settings to install a CA
  certificate. Browser/managed-device policy may restrict user-installed CAs.
- **Firefox:** if it does not use the OS trust store, import the root under
  Settings > Privacy & Security > Certificates > Authorities.

Restart/reopen the browser after trusting the certificate. The browser should
show a trusted connection with no certificate warning. In developer tools,
`window.isSecureContext` should be true. Do not disable certificate checking or
browser web security as a solution.

To inspect the CA fingerprint before sharing:

```bash
openssl x509 -in .local-https/root.crt -noout -fingerprint -sha256
```

If the CA volume is deleted, the regenerated CA is different and must be trusted
again. Do not run `docker compose down -v`: that also deletes the active report
database volume. To stop normally, use `docker compose down` without `-v`.

## What HTTPS fixes, and what it does not

Browsers restrict APIs such as `crypto.randomUUID()` on plain HTTP LAN origins,
while localhost is specially trusted. Trusted HTTPS enables those APIs and
encrypts browser-to-laptop traffic. The UUID fallback remains for HTTP tests.
HTTPS does not fix arbitrary application bugs or add login/access control.
Anyone able to reach this local service can still use the shared workspace;
keep it on a trusted network and do not forward these ports to the internet.
The separate Cloudflare deployment continues to use publicly trusted HTTPS and
Access; it does not use this local CA or Caddy container.

See [Caddy local HTTPS](https://caddyserver.com/docs/automatic-https#local-https)
and [browser secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).
