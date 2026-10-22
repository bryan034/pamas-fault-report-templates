import { FileText, LockKeyhole, LoaderCircle } from "lucide-react";

type Props = {
  loading: boolean;
  forbidden: boolean;
  unavailable: boolean;
  loginUrl: string | null;
  callbackError: string;
  onRetry: () => void;
};

export function LoginScreen({loading, forbidden, unavailable, loginUrl, callbackError, onRetry}: Props) {
  const denied = forbidden || callbackError === "not_approved";
  const title = loading ? "Opening your workspace"
    : denied ? "Access approval required"
    : unavailable ? "We couldn’t connect"
    : "Sign in to Report Formatter";
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-heading" aria-busy={loading}>
        <div className="login-brand"><span className="login-brand-icon"><FileText aria-hidden="true" /></span><span>Report Formatter</span></div>
        <p className="login-eyebrow"><LockKeyhole size={13} aria-hidden="true" /> Private company workspace</p>
        <h1 id="login-heading">{title}</h1>
        {loading ? (
          <p className="login-loading" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Checking your sign-in…</p>
        ) : (
          <>
            <p className="login-description">{denied
              ? "Your account needs permission from the application administrator before you can open company templates and reports."
              : unavailable
                ? "The application service is temporarily unavailable. Check your connection and try again."
                : "Use your approved Google account to access your company’s templates, drafts and reports."}</p>
            {denied && <div className="login-notice" role="alert">Ask your administrator to approve your Google account email, or sign in with a different approved account.</div>}
            {!denied && callbackError === "login_failed" && <div className="login-notice" role="alert">Google sign-in wasn’t completed. Please try again.</div>}
            <div className="login-actions">
              {!unavailable && loginUrl && <a className="login-google-button" href={loginUrl}>Sign in with Google <span aria-hidden="true">→</span></a>}
              {(unavailable || denied) && <button className="login-retry-button" type="button" onClick={onRetry}>{unavailable ? "Try again" : "Check access again"}</button>}
            </div>
            <p className="login-help">{unavailable
              ? "If the problem continues, contact your application administrator."
              : "Only approved company accounts can access this workspace. Signing in does not create an account or grant access."}</p>
          </>
        )}
        <div className="login-footer"><LockKeyhole size={14} aria-hidden="true" /><span>Your Google password is never shared with Report Formatter.</span></div>
      </section>
    </main>
  );
}
