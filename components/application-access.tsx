"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { createContext, useContext, useEffect, useState } from "react";
import { templateJson } from "@/lib/template-api";

type Identity = {
  mode: "local" | "cloudflare";
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
const Context = createContext<Access>({
  user: null,
  loading: true,
  error: "",
  canEdit: false,
  canManage: false,
});
export const useApplicationAccess = () => useContext(Context);

export function ApplicationAccess({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void templateJson<Identity>("/api/access/me")
      .then((value) => {
        if (active) setUser(value);
      })
      .catch((cause) => {
        if (active) setError(String(cause.message));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const canManage = user?.role === "owner";
  return (
    <Context.Provider
      value={{
        user,
        loading,
        error,
        canManage,
        canEdit: canManage || user?.role === "editor",
      }}
    >
      <div className="application-access-bar" aria-label="Application access">
        <a href="/">Report Formatter</a>
        <span>
          {loading
            ? "Checking access…"
            : error ||
              (user?.mode === "local"
                ? "Local development — no login"
                : `${user?.email} · ${user?.role}`)}
        </span>
        {(canManage || user?.mode === "local") && (
          <a href="/access">Manage access</a>
        )}
        {user?.mode === "cloudflare" && (
          <a href="/cdn-cgi/access/logout">Sign out</a>
        )}
      </div>
      {loading ? (
        <main className="catalog-shell"><p role="status">Checking application access…</p></main>
      ) : error || !user ? (
        <main className="catalog-shell">
          <section className="catalog-content">
            <h1>Application access required</h1>
            <p role="alert">{error || "Sign in with an approved account to continue."}</p>
            <p>For hosted access, use Google sign-in and ask the administrator to approve your account email.</p>
            <a href="/">Retry access check</a>
          </section>
        </main>
      ) : children}
    </Context.Provider>
  );
}
