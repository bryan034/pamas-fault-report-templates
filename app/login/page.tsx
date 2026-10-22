export default function LoginPage() {
  // The root access gate owns session checking and renders the shared login screen.
  // Authenticated users are redirected to their template library by that gate.
  return <p className="login-redirect" role="status">Opening your workspace…</p>;
}
