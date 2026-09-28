"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, FilePlus2, Pencil, Search, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiJson, DraftSummary, migrateBrowserDrafts } from "@/lib/fault-report-api";

export default function FaultReportDrafts() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [templateName, setTemplateName] = useState("Fault Report Generator");
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("");
  const [jobFrom, setJobFrom] = useState("");
  const [jobTo, setJobTo] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<DraftSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 3000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const load = async () => {
      try {
        try { await migrateBrowserDrafts(); }
        catch { setError("Existing browser drafts could not be imported. They remain in this browser; new database drafts are still available."); }
        const [draftResult, setting] = await Promise.all([
          apiJson<{ drafts: DraftSummary[] }>("/api/drafts"),
          apiJson<{ display_name: string }>("/api/template-settings/fault-report"),
        ]);
        setDrafts(draftResult.drafts); setTemplateName(setting.display_name);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load drafts."); }
      finally { setLoading(false); }
    };
    void load();
  }, []);

  const companies = useMemo(() => [...new Set(drafts.map((draft) => draft.company).filter(Boolean))].sort(), [drafts]);
  const shown = useMemo(() => drafts.filter((draft) => {
    const date = draft.report_date;
    return (!search || `${draft.title} ${draft.company}`.toLowerCase().includes(search.toLowerCase()))
      && (!company || draft.company === company)
      && (!jobFrom || (date !== "" && date >= jobFrom))
      && (!jobTo || (date !== "" && date <= jobTo));
  }), [drafts, search, company, jobFrom, jobTo]);

  const saveTitle = async (id: string) => {
    if (!editingTitle.trim()) { setError("A draft title is required."); return; }
    try {
      const changed = await apiJson<DraftSummary>(`/api/drafts/${id}/title`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: editingTitle.trim() }),
      });
      setDrafts((current) => current.map((draft) => draft.id === id ? changed : draft));
      setEditingId(null); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not rename draft."); }
  };

  const deleteDraft = async (draft: DraftSummary) => {
    setDeletingId(draft.id);
    try {
      await apiJson<void>(`/api/drafts/${draft.id}`, { method: "DELETE" });
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setDraftToDelete(null);
      setError(`Deleted "${draft.title}"`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete draft."); }
    finally { setDeletingId(null); }
  };

  return <main className="catalog-shell">
    <header className="catalog-header"><a href="/" className="back-link"><ArrowLeft size={18} /> All templates</a><div className="catalog-header-heading"><h1>{templateName}</h1><p>Saved drafts and new reports</p></div><Button asChild><a href="/templates/fault-report/new"><FilePlus2 size={17} /> New report</a></Button></header>
    <section className="catalog-content"><div className="catalog-intro"><span className="eyebrow">FAULT REPORTS</span><h2>Your drafts</h2><p>Open a draft to continue editing, or start with a blank report.</p></div>
      <div className="draft-filters"><label><span>Search title or company</span><div className="search-input"><Search size={17} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search drafts" /></div></label><label><span>Company</span><select value={company} onChange={(event) => setCompany(event.target.value)}><option value="">All companies</option>{companies.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label><span>jobs between</span><Input type="date" value={jobFrom} onChange={(event) => setJobFrom(event.target.value)} /></label><label><span>and</span><Input type="date" value={jobTo} onChange={(event) => setJobTo(event.target.value)} /></label></div>
      {error && <div className="feedback-toast" role="status" aria-live="polite">{error}</div>}
      {loading ? <p className="list-state">Loading drafts…</p> : shown.length === 0 ? <div className="empty-drafts"><FilePlus2 size={28} /><h3>{drafts.length ? "No drafts match these filters" : "No drafts yet"}</h3><p>{drafts.length ? "Try another search or date range." : "Create a report and give it a title before saving."}</p><Button asChild><a href="/templates/fault-report/new">Create report</a></Button></div> : <div className="draft-grid">{shown.map((draft) => <article className="draft-card" key={draft.id}>
        <a href={`/templates/fault-report/drafts/${draft.id}`} className="draft-thumbnail" aria-label={`Open ${draft.title}`}><img src="/template-preview.png" alt="Fault report template" /></a>
        <div className="draft-card-body"><div className="draft-card-heading">{editingId === draft.id ? <div className="rename-inline"><Input value={editingTitle} maxLength={100} autoFocus onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveTitle(draft.id); if (event.key === "Escape") setEditingId(null); }} /><Button size="sm" onClick={() => void saveTitle(draft.id)}>Save</Button></div> : <><h3>{draft.title}</h3><Button size="icon" variant="ghost" aria-label={`Rename ${draft.title}`} onClick={() => { setEditingId(draft.id); setEditingTitle(draft.title); }}><Pencil size={16} /></Button><Button size="icon" variant="ghost" className="delete-draft" aria-label={`Delete ${draft.title}`} disabled={deletingId === draft.id} onClick={() => setDraftToDelete(draft)}><Trash2 size={16} /></Button></>}</div>
          <p>{draft.company || "No company selected"}</p><time dateTime={draft.created_at}>Created {new Date(draft.created_at).toLocaleString()}</time><a href={`/templates/fault-report/drafts/${draft.id}`} className="card-open">Open draft <ArrowRight size={16} /></a></div>
      </article>)}</div>}
    </section>
    <AlertDialog open={draftToDelete !== null} onOpenChange={(open) => { if (!open && !deletingId) setDraftToDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete draft?</AlertDialogTitle>
          <AlertDialogDescription>Are you sure you want to delete &quot;{draftToDelete?.title}&quot;? This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletingId !== null}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={deletingId !== null} onClick={() => { if (draftToDelete) void deleteDraft(draftToDelete); }}>
            {deletingId ? "Deleting…" : "Delete draft"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}
