"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { templateApiBase, templateJson, TemplateRequestError } from "@/lib/template-api";
import { LoginScreen } from "@/components/login-screen";

type Identity = {
  mode: "local" | "google";
  email: string | null;
  role: "owner" | "editor" | "viewer";
};
type Access = {
  user: Identity | null;
  loading: boolean;
  error: string;
  canEdit: boolean;
  canManage: boolean;
};
const Context = createContext<Access>({user: null, loading: true, error: "", canEdit: false, canManage: false});
export const useApplicationAccess = () => useContext(Context);

export function ApplicationAccess({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(0);
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [callbackError, setCallbackError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      templateJson<{enabled: boolean}>("/api/auth/config"),
      templateJson<Identity>("/api/access/me"),
    ]).then(([config, identity]) => {
      if (!active) return;
      setCallbackError(new URLSearchParams(window.location.search).get("auth_error") || "");
      setLoginEnabled(config.status === "fulfilled" && config.value.enabled);
      if (identity.status === "fulfilled") {
        setUser(identity.value);
        setStatus(200);
        setError("");
      } else {
        setUser(null);
        const cause = identity.reason;
        setStatus(cause instanceof TemplateRequestError ? cause.status : 0);
        setError(cause instanceof Error ? cause.message : "Could not check access");
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [attempt]);

  // A dedicated sign-in URL also works when opening a protected editor directly.
  useEffect(() => {
    if (loading) return;
    if (user && pathname === "/login") router.replace("/");
    else if (!user && pathname !== "/login") {
      const query = callbackError === "not_approved" || callbackError === "login_failed"
        ? `?auth_error=${callbackError}` : "";
      router.replace(`/login${query}`);
    }
  }, [loading, user, pathname, callbackError, router]);

  const canManage = user?.role === "owner";
  const unavailable = ![401, 403].includes(status) || !loginEnabled;
  return (
    <Context.Provider value={{user, loading, error, canManage, canEdit: canManage || user?.role === "editor"}}>
      {loading || !user ? (
        <LoginScreen loading={loading} forbidden={status === 403} unavailable={unavailable}
          loginUrl={loginEnabled ? `${templateApiBase()}/api/auth/google` : null}
          callbackError={callbackError}
          onRetry={() => {setLoading(true); setAttempt(value => value + 1);}} />
      ) : (
        <>
          <div className="application-access-bar" aria-label="Application access">
            <a href="/">Report Formatter</a>
            <span>{user.mode === "local" ? "Local development — no login" : `${user.email} · ${user.role}`}</span>
            {(canManage || user.mode === "local") && <a href="/access">Manage access</a>}
            {user.mode === "google" && <button type="button" onClick={async () => {
              try {
                await templateJson("/api/auth/logout", {method: "POST"});
                // Full navigation discards private editor state and rechecks the session.
                window.location.assign(new URL("/login", window.location.origin).href);
              } catch (cause) {setError(cause instanceof Error ? cause.message : "Could not sign out");}
            }}>Sign out</button>}
          </div>
          {error && <p className="access-action-error" role="alert">{error}</p>}
          {children}
        </>
      )}
    </Context.Provider>
  );
}
