"use client";
import { useEffect, useState } from "react";

type BackupOutcome = { status: "saved" | "restored" | "cancelled" | "failed"; message?: string; lastBackupAt?: string | null };

/** Provided by desktop/preload.cjs in the Windows app; absent in web deployments. */
type DesktopBridge = {
  lastBackupAt(): Promise<string | null>;
  backup(): Promise<BackupOutcome>;
  restore(): Promise<BackupOutcome>;
};

declare global {
  interface Window {
    reportFormatterDesktop?: DesktopBridge;
  }
}

const describe = (value: string | null | undefined) =>
  value
    ? `Last backup: ${new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
    : "Not backed up yet";

export function DesktopBackup() {
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    void window.reportFormatterDesktop?.lastBackupAt().then(setLastBackupAt);
  }, []);

  async function run(action: "backup" | "restore") {
    const bridge = window.reportFormatterDesktop;
    if (!bridge) return;
    setBusy(true);
    setProblem("");
    const outcome = await bridge[action]();
    setBusy(false);
    if (outcome.status === "failed") setProblem(outcome.message || "That did not work. Please try again.");
    if (outcome.status === "saved") setLastBackupAt(outcome.lastBackupAt ?? null);
  }

  return (
    <>
      <span role={problem ? "alert" : undefined}>{problem || describe(lastBackupAt)}</span>
      <button type="button" disabled={busy} onClick={() => void run("backup")}>{busy ? "Working…" : "Back up"}</button>
      <button type="button" disabled={busy} onClick={() => void run("restore")}>Restore</button>
    </>
  );
}
