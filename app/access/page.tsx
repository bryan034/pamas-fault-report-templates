"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState } from "react";
import { useApplicationAccess } from "@/components/application-access";
import { templateJson } from "@/lib/template-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

type Grant = { email: string; role: "editor" | "viewer" };
type Users = { owner: string; users: Grant[] };
export default function AccessPage() {
  const access = useApplicationAccess();
  const [data, setData] = useState<Users | null>(null),
    [address, setAddress] = useState("");
  const [role, setRole] = useState<Grant["role"]>("viewer"),
    [error, setError] = useState("");
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState<string | null>(null);
  const load = () => templateJson<Users>("/api/access/users").then(setData);
  useEffect(() => {
    if (access.canManage) void load().catch((cause) => setError(cause.message));
  }, [access.canManage]);
  const save = async (grant: Grant) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await templateJson("/api/access/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(grant),
      });
      await load();
      setAddress("");
      setNotice(
        `Access saved for ${grant.email}. They can sign in with that Google account.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save access",
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setError("");
    try {
      await templateJson(`/api/access/users/${encodeURIComponent(removing)}`, {
        method: "DELETE",
      });
      await load();
      setRemoving(null);
      setNotice("Application access revoked. Documents have not been deleted.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not revoke access",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="catalog-shell">
      <section className="catalog-content access-settings">
        <a href="/">← All templates</a>
        <h1>Application access</h1>
        {access.loading ? (
          <p>Checking access…</p>
        ) : access.user?.mode === "local" ? (
          <p>
            Access management requires Cloudflare sign-in. Configure Google
            sign-in and Access for the hosted deployment, or use .env.tunnel
            with a protected named Tunnel. Local development has no login and
            cannot manage grants.
          </p>
        ) : !access.canManage ? (
          <p role="alert">
            {access.error || "Only the configured owner can manage access."}
          </p>
        ) : (
          <>
            <p>
              Owner: {data?.owner || access.user?.email}. The owner is
              configured by environment and cannot be changed here.
            </p>
            <p>
              These roles apply to all templates and reports. Editors can
              create, edit and delete content. Viewers can browse and download
              saved reports. Only the owner can manage access.
            </p>
            <p>
              Google sign-in is handled by Cloudflare Access. This list decides
              which signed-in accounts can use the application. With the Google
              login-method policy configured, you only need to manage emails here.
              This page does not send invitations or change Cloudflare policies.
            </p>
            <form
              className="access-grant-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save({ email: address, role });
              }}
            >
              <label>
                Email
                <Input
                  type="email"
                  required
                  maxLength={254}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              </label>
              <label>
                Role
                <select
                  aria-label="Role"
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as Grant["role"])
                  }
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
              </label>
              <Button type="submit" disabled={busy}>
                Grant access
              </Button>
            </form>
            <div className="access-user-list">
              {data?.users.map((grant) => (
                <div className="access-user-row" key={grant.email}>
                  <span>{grant.email}</span>
                  <select
                    aria-label={`Role for ${grant.email}`}
                    disabled={busy}
                    value={grant.role}
                    onChange={(event) =>
                      void save({
                        ...grant,
                        role: event.target.value as Grant["role"],
                      })
                    }
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setRemoving(grant.email)}
                  >
                    Remove access
                  </Button>
                </div>
              ))}
            </div>
            {error && (
              <p className="catalog-error" role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
          </>
        )}
      </section>
      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke application access?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing} will no longer be able to open this application’s data.
              Saved reports will not be deleted. Downloads already made cannot
              be revoked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={busy} onClick={() => void remove()}>
              Revoke access
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
