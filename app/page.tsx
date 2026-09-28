"use client";

import { useEffect, useState } from "react";
import { ArrowRight, FileText, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiJson } from "@/lib/fault-report-api";

export default function Home() {
  const [name, setName] = useState("Fault Report Generator");
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void apiJson<{ display_name: string }>("/api/template-settings/fault-report")
      .then((value) => { setName(value.display_name); setDraftName(value.display_name); })
      .catch(() => setError("Cannot reach the fault-report service. Start Docker Compose to manage templates."));
  }, []);

  const saveName = async () => {
    if (!draftName.trim()) { setError("Enter a template name."); return; }
    try {
      const result = await apiJson<{ display_name: string }>("/api/template-settings/fault-report", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: draftName.trim() }),
      });
      setName(result.display_name); setEditing(false); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not rename template."); }
  };

  return <main className="catalog-shell">
    <header className="catalog-header"><div className="brand-mark"><FileText /></div><div><h1>Report Formatter</h1><p>Choose a template to create or continue a report.</p></div></header>
    <section className="catalog-content"><div className="catalog-intro"><span className="eyebrow">TEMPLATE LIBRARY</span><h2>Your report templates</h2><p>Each template has its own drafts and report builder.</p></div>
      <div className="template-grid"><article className="template-card">
        <a href="/templates/fault-report" className="template-card-preview" aria-label={`Open ${name}`}><img src="/template-preview.png" alt="Blank fault report form" /></a>
        <div className="template-card-body"><div className="template-card-title"><span className="template-icon"><FileText size={19} /></span>{editing ? <div className="rename-inline"><Input value={draftName} maxLength={100} autoFocus onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveName(); if (event.key === "Escape") setEditing(false); }} /><Button size="sm" onClick={saveName}>Save</Button></div> : <><h3>{name}</h3><Button size="icon" variant="ghost" aria-label="Rename template" onClick={() => { setDraftName(name); setEditing(true); }}><Pencil size={16} /></Button></>}</div>
          <p>Thermal-image fault reports with guided fields and a PDF-matched preview.</p><a href="/templates/fault-report" className="card-open">Open template <ArrowRight size={17} /></a></div>
      </article></div>{error && <p className="catalog-error" role="alert">{error}</p>}
    </section>
  </main>;
}
