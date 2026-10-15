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
  const [template, setTemplate] = useState<TemplateDetail | null>(null),
    [drafts, setDrafts] = useState<CustomDraftSummary[]>([]);
  const [search, setSearch] = useState(""),
    [company, setCompany] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null),
    [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<CustomDraftSummary | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const base = `/api/templates/${templateId}`;
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      templateJson<TemplateDetail>(base),
      templateJson<{ drafts: CustomDraftSummary[] }>(`${base}/drafts`),
    ])
      .then(([t, d]) => {
        if (!cancelled) {
          setTemplate(t);
          setDrafts(d.drafts);
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
  }, [base]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const companies = useMemo(
    () =>
      [...new Set(drafts.map((draft) => draft.company).filter(Boolean))].sort(),
    [drafts],
  );
  const shown = useMemo(
    () =>
      drafts.filter(
        (draft) =>
          (!search ||
            `${draft.title} ${draft.company}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!company || draft.company === company) &&
          (!from || draft.report_date >= from) &&
          (!to || (!!draft.report_date && draft.report_date <= to)),
      ),
    [drafts, search, company, from, to],
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
      setNotice("Draft deleted.");
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not delete draft",
      );
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
  const downloadDraft = async (draft: CustomDraftSummary) => {
    try {
      const response = await templateRequest(`${base}/drafts/${draft.id}/pdf`);
      const filename =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] || `${draft.title}.pdf`;
      downloadBlob(await response.blob(), filename);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not download draft",
      );
    }
  };
  const hasCompany =
      template?.definition.fields.some((field) => field.role === "company") ||
      drafts.some((draft) => !!draft.company),
    hasDate =
      template?.definition.fields.some(
        (field) => field.role === "report_date",
      ) || drafts.some((draft) => !!draft.report_date);
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
          <h2>Your drafts</h2>
          <p>Open a saved report or start with empty fields.</p>
        </div>
        <div className="template-toolbar report-library-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void download("background")}
          >
            Download blank PDF
          </Button>
          {!template?.archived && (
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
            <h3>{drafts.length ? "No matching drafts" : "No drafts yet"}</h3>
            <p>Create a report and give it a title before saving.</p>
            <Button asChild>
              <a href={`/templates/custom/${templateId}/new`}>Create report</a>
            </Button>
          </div>
        ) : (
          <div className="draft-grid">
            {shown.map((draft) => (
              <article className="draft-card" key={draft.id}>
                <a
                  className="draft-thumbnail"
                  href={`/templates/custom/${templateId}/drafts/${draft.id}`}
                  aria-label={`Open ${draft.title}`}
                >
                  <img
                    src={`${templateApiBase()}${base}/thumbnail`}
                    alt="Blank report template"
                  />
                </a>
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
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Download ${draft.title}`}
                          onClick={() => void downloadDraft(draft)}
                        >
                          <Download size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="delete-draft"
                          aria-label={`Delete ${draft.title}`}
                          onClick={() => setDeleting(draft)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </>
                    )}
                  </div>
                  {draft.company && <p>{draft.company}</p>}
                  <time dateTime={draft.created_at}>
                    Created {new Date(draft.created_at).toLocaleString()}
                  </time>
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`/templates/custom/${templateId}/drafts/${draft.id}`}
                    >
                      Edit draft
                    </a>
                  </Button>
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
              Delete &quot;{deleting?.title}&quot;? This action cannot be
              undone.
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
