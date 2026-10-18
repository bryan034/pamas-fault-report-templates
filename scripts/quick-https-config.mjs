export const connectorImage =
  "cloudflare/cloudflared@sha256:a15a3b50b8dabd57ac2090e9484c0247dba9dfa1f0df4d298d4317f9d69eb2d5";

export function quickAccessMode(value = "email") {
  if (!["email", "public"].includes(value))
    throw new Error("QUICK_TEST_ACCESS must be email or public.");
  return value;
}

export function approvedEmails(raw) {
  const values = String(raw || "")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  if (
    !values.length ||
    values.some(
      (value) =>
        value.length > 254 ||
        !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value),
    )
  ) {
    throw new Error(
      "Provide real email addresses you can receive login codes at. Wildcards, missing emails and hostnames such as example.gmail.com are not allowed.",
    );
  }
  return [...new Set(values)].join(",");
}

export function quickUrl(logs) {
  return (
    logs.match(
      /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/i,
    )?.[0] || null
  );
}

export function isLoginRedirect(response, publicUrl) {
  if (![301, 302, 303, 307, 308].includes(response.status)) return false;
  const location = response.headers.get("location");
  if (!location) return false;
  const url = new URL(location, publicUrl);
  return (
    url.protocol === "https:" &&
    (url.hostname === "login.trycloudflare.com" ||
      url.hostname.endsWith(".cloudflareaccess.com") ||
      (url.origin === new URL(publicUrl).origin &&
        url.pathname.startsWith("/cdn-cgi/access/")))
  );
}
