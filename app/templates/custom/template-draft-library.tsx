"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation avoids the current Vinext/Next Link runtime mismatch. */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  FilePlus2,
  Pencil,
  Search,
  Trash2,
  RotateCcw,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApplicationAccess } from "@/components/application-access";
import {
  CustomDraftSummary,
  TemplateDetail,
  downloadBlob,
  templateApiBase,
  templateJson,
  templateRequest,
} from "@/lib/template-api";

export default function TemplateDraftLibrary({
  templateId,
}: {
  templateId: string;
}) {
  const { canEdit } = useApplicationAccess();
  const [template, setTemplate] = useState<TemplateDetail | null>(null),
    [drafts, setDrafts] = useState<CustomDraftSummary[]>([]);
  const [deletedDrafts, setDeletedDrafts] = useState<CustomDraftSummary[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [search, setSearch] = useState(""),
    [company, setCompany] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null),
    [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<CustomDraftSummary | null>(null),
    [busy, setBusy] = useState(false);
  const [downloadTarget, setDownloadTarget] =
      useState<CustomDraftSummary | null>(null),
    [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const base = `/api/templates/${templateId}`;
  const refreshDeleted = async () => {
    const result = await templateJson<{drafts: CustomDraftSummary[]}>(`${base}/deleted-drafts`);
    setDeletedDrafts(result.drafts);
  };
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      templateJson<TemplateDetail>(base),
      templateJson<{ drafts: CustomDraftSummary[] }>(`${base}/drafts`),
      canEdit ? templateJson<{ drafts: CustomDraftSummary[] }>(`${base}/deleted-drafts`)
        : Promise.resolve({drafts: [] as CustomDraftSummary[]}),
    ])
      .then(([t, d, trash]) => {
        if (!cancelled) {
          setTemplate(t);
          setDrafts(d.drafts);
          setDeletedDrafts(trash.drafts);
        }
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "Could not load drafts",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [base, canEdit]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const companies = useMemo(
    () =>
      [...new Set([...drafts, ...deletedDrafts].map((draft) => draft.company).filter(Boolean))].sort(),
    [drafts, deletedDrafts],
  );
  const shown = useMemo(
    () =>
      (showDeleted ? deletedDrafts : drafts).filter(
        (draft) =>
          (!search ||
            `${draft.title} ${draft.company}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!company || draft.company === company) &&
          (!from || draft.report_date >= from) &&
          (!to || (!!draft.report_date && draft.report_date <= to)),
      ),
    [drafts, deletedDrafts, showDeleted, search, company, from, to],
  );
  const rename = async (id: string) => {
    if (!title.trim()) {
      setNotice("A draft title is required.");
      return;
    }
    try {
      const updated = await templateJson<CustomDraftSummary>(
        `${base}/drafts/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim() }),
        },
      );
      setDrafts((current) =>
        current.map((draft) => (draft.id === id ? updated : draft)),
      );
      setRenaming(null);
      setNotice("Draft renamed.");
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not rename draft",
      );
    }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await templateJson(`${base}/drafts/${deleting.id}`, { method: "DELETE" });
      setDrafts((current) =>
        current.filter((draft) => draft.id !== deleting.id),
      );
      setDeleting(null);
      setNotice("Draft moved to Recently Deleted. You can restore it for 30 days.");
      await refreshDeleted();
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not delete draft",
      );
    } finally {
      setBusy(false);
    }
  };
  const restore = async (draft: CustomDraftSummary) => {
    setBusy(true);
    try {
      const restored = await templateJson<CustomDraftSummary>(`${base}/drafts/${draft.id}/restore`, {method: "POST"});
      setDeletedDrafts(current => current.filter(item => item.id !== draft.id));
      setDrafts(current => [restored, ...current.filter(item => item.id !== draft.id)]);
      setNotice(`Restored “${draft.title}”. Open Your drafts to continue editing.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not restore draft");
    } finally {
      setBusy(false);
    }
  };
  const download = async (kind: "background") => {
    try {
      const response = await templateRequest(`${base}/${kind}`);
      downloadBlob(
        await response.blob(),
        `${template?.title || "template"}-blank.pdf`,
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Download failed");
    }
  };
  const downloadDraft = async (
    draft: CustomDraftSummary,
    format: "pdf" | "docx",
  ) => {
    setDownloading(true);
    try {
      const response = await templateRequest(
        `${base}/drafts/${draft.id}/download?format=${format}`,
      );
      const filename =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] || `${draft.title}.${format}`;
      downloadBlob(await response.blob(), filename);
      setDownloadTarget(null);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not download draft",
      );
    } finally {
      setDownloading(false);
    }
  };
  const hasCompany =
      template?.definition.fields.some((field) => field.role === "company") ||
      [...drafts, ...deletedDrafts].some((draft) => !!draft.company),
    hasDate =
      template?.definition.fields.some(
        (field) => field.role === "report_date",
      ) || [...drafts, ...deletedDrafts].some((draft) => !!draft.report_date);
  return (
    <main className="catalog-shell">
      <header className="catalog-header">
        <a href="/" className="back-link">
          <ArrowLeft size={18} /> All templates
        </a>
        <div className="catalog-header-heading">
          <h1>{template?.title || "Report template"}</h1>
          <p>Saved drafts and new reports</p>
        </div>
      </header>
      <section className="catalog-content">
        <div className="catalog-intro">
          <span className="eyebrow">REPORTS</span>
          <h2>{showDeleted ? "Recently Deleted" : "Your drafts"}</h2>
          <p>{showDeleted
            ? "Restore deleted drafts within 30 days. After that they are permanently deleted."
            : "Open a saved report or start with empty fields."}</p>
        </div>
        <div className="template-toolbar report-library-actions">
          {canEdit && <>
            <Button size="sm" aria-pressed={!showDeleted} variant={showDeleted ? "outline" : "default"} onClick={() => setShowDeleted(false)}>
              Your drafts ({drafts.length})
            </Button>
            <Button size="sm" aria-pressed={showDeleted} variant={showDeleted ? "default" : "outline"} onClick={() => {
              setShowDeleted(true);
              void refreshDeleted().catch(cause => setNotice(cause.message || "Could not refresh Recently Deleted"));
            }}>
              <Trash2 size={15} /> Recently Deleted ({deletedDrafts.length})
            </Button>
          </>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void download("background")}
          >
            Download blank PDF
          </Button>
          {canEdit && !template?.archived && (
            <>
              <Button asChild size="sm">
                <a href={`/templates/custom/${templateId}/edit`}>
                  Edit template
                </a>
              </Button>
              {template && (
                <Button asChild size="sm" className="new-report-action">
                  <a href={`/templates/custom/${templateId}/new`}>
                    <FilePlus2 size={17} /> New report
                  </a>
                </Button>
              )}
            </>
          )}
          {template?.archived && (
            <p>
              This template is archived. Its saved reports remain available.
            </p>
          )}
        </div>
        <div className="draft-filters">
          <label>
            <span>Search title or company</span>
            <div className="search-input">
              <Search size={17} />
              <Input
                placeholder="Search drafts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>
          {hasCompany && (
            <label>
              <span>Company</span>
              <select
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              >
                <option value="">All companies</option>
                {companies.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
          {hasDate && (
            <>
              <label>
                <span>jobs between</span>
                <Input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                <span>and</span>
                <Input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
            </>
          )}
        </div>
        {error ? (
          <p className="catalog-error" role="alert">
            {error}
          </p>
        ) : !template ? (
          <p className="list-state">Loading drafts…</p>
        ) : !shown.length ? (
          <div className="empty-drafts">
            <FilePlus2 />
            <h3>{(showDeleted ? deletedDrafts : drafts).length ? "No matching drafts" : showDeleted ? "No recently deleted drafts" : "No drafts yet"}</h3>
            <p>{showDeleted ? "Deleted drafts appear here for up to 30 days." : "Create a report and give it a title before saving."}</p>
            {canEdit && !showDeleted && !template.archived && (
              <Button asChild>
                <a href={`/templates/custom/${templateId}/new`}>
                  Create report
                </a>
              </Button>
            )}
          </div>
        ) : (
          <div className="draft-grid">
            {shown.map((draft) => (
              <article className="draft-card" key={draft.id}>
                {showDeleted ? (
                  <div className="draft-thumbnail">
                    <img src={`${templateApiBase()}${base}/thumbnail`} alt="Deleted report template" />
                  </div>
                ) : <a
                  className="draft-thumbnail"
                  href={`/templates/custom/${templateId}/drafts/${draft.id}`}
                  aria-label={`Open ${draft.title}`}
                >
                  <img
                    src={`${templateApiBase()}${base}/thumbnail`}
                    alt="Blank report template"
                  />
                </a>}
                <div className="draft-card-body">
                  <div className="draft-card-heading">
                    {renaming === draft.id ? (
                      <div className="rename-inline">
                        <Input
                          value={title}
                          maxLength={100}
                          onChange={(event) => setTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void rename(draft.id);
                            if (event.key === "Escape") setRenaming(null);
                          }}
                        />
                        <Button size="sm" onClick={() => void rename(draft.id)}>
                          Save
                        </Button>
                      </div>
                    ) : (
                      <>
                        <h3>{draft.title}</h3>
                        {!showDeleted && <div className="draft-card-actions">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Rename ${draft.title}`}
                              onClick={() => {
                                setRenaming(draft.id);
                                setTitle(draft.title);
                              }}
                            >
                              <Pencil size={16} />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Download ${draft.title}`}
                            onClick={() => setDownloadTarget(draft)}
                          >
                            <Download size={16} />
                          </Button>
                        </div>}
                      </>
                    )}
                  </div>
                  {draft.company && <p>{draft.company}</p>}
                  <time dateTime={draft.created_at}>
                    Created {new Date(draft.created_at).toLocaleString()}
                  </time>
                  {showDeleted && <>
                    <p>Deleted {new Date(draft.deleted_at!).toLocaleString()}</p>
                    <p>Permanently deletes {new Date(draft.expires_at!).toLocaleString()}</p>
                  </>}
                  <div className="draft-card-footer">
                    {showDeleted ? (
                      <Button size="sm" disabled={busy} onClick={() => void restore(draft)} aria-label={`Restore ${draft.title}`}>
                        <RotateCcw size={15} /> Restore draft
                      </Button>
                    ) : <Button asChild size="sm" variant="outline">
                      <a
                        href={`/templates/custom/${templateId}/drafts/${draft.id}`}
                      >
                        {canEdit ? "Edit draft" : "View draft"}
                      </a>
                    </Button>}
                    {canEdit && !showDeleted && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="delete-draft"
                        aria-label={`Delete ${draft.title}`}
                        onClick={() => setDeleting(draft)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {notice && (
        <div className="feedback-toast" role="status">
          {notice}
        </div>
      )}
      <Dialog
        open={!!downloadTarget}
        onOpenChange={(open) => {
          if (!open && !downloading) setDownloadTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a download format</DialogTitle>
            <DialogDescription>
              Download “{downloadTarget?.title}” as a PDF or Word document.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={downloading}
              onClick={() => setDownloadTarget(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={downloading}
              onClick={() => {
                if (downloadTarget) void downloadDraft(downloadTarget, "pdf");
              }}
            >
              Download PDF
            </Button>
            <Button
              disabled={downloading}
              onClick={() => {
                if (downloadTarget) void downloadDraft(downloadTarget, "docx");
              }}
            >
              Download Word
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Move &quot;{deleting?.title}&quot; to Recently Deleted? You can
              restore it for 30 days before it is permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={busy} onClick={() => void remove()}>
              Delete draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
