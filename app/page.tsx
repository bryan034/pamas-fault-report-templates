"use client";
// Full navigation avoids the Vinext Link runtime mismatch.
import { useCallback, useEffect, useState } from "react";
import { FileText, Pencil, Plus, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApplicationAccess } from "@/components/application-access";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  type TemplateSummary,
  templateApiBase,
  templateJson,
} from "@/lib/template-api";

type Card = {
  id: string;
  title: string;
  archived: boolean;
  url: string;
  thumbnail: string;
};
function TemplateCard({
  card,
  onArchive,
  onRestore,
  onDelete,
  onRename,
}: {
  card: Card;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onRename: (title: string) => Promise<void>;
}) {
  const { canEdit } = useApplicationAccess();
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(card.title),
    [error, setError] = useState("");
  const save = async () => {
    if (!title.trim()) {
      setError("Enter a template name.");
      return;
    }
    try {
      await onRename(title.trim());
      setEditing(false);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not rename template",
      );
    }
  };
  return (
    <article className="template-card">
      <a
        href={card.url}
        className="template-card-preview"
        aria-label={`Open ${card.title}`}
      >
        <img src={card.thumbnail} alt={`${card.title} blank form`} />
      </a>
      <div className="template-card-body">
        <div className="template-card-title">
          <span className="template-icon">
            <FileText size={19} />
          </span>
          {editing ? (
            <div className="rename-inline">
              <Input
                value={title}
                maxLength={100}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void save();
                  if (event.key === "Escape") setEditing(false);
                }}
              />
              <Button size="sm" onClick={() => void save()}>
                Save
              </Button>
            </div>
          ) : (
            <>
              <h3>{card.title}</h3>
              {canEdit && <Button
                size="icon"
                variant="ghost"
                aria-label={`Rename ${card.title}`}
                onClick={() => {
                  setTitle(card.title);
                  setEditing(true);
                }}
              >
                <Pencil size={16} />
              </Button>}
            </>
          )}
          {canEdit && !card.archived && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete ${card.title}`}
              onClick={onArchive}
            >
              <Trash2 size={16} />
            </Button>
          )}
        </div>
        <p>
          {card.archived
            ? "Archived — saved reports are retained."
            : "Create or continue reports using this template."}
        </p>
        <div className="template-card-actions">
          <Button asChild size="sm">
            <a href={card.url}>
              {card.archived ? "View saved reports" : "Open template"}
            </a>
          </Button>
          {canEdit && !card.archived && (
            <Button asChild size="sm" variant="outline">
              <a href={`/templates/custom/${card.id}/edit`}>Edit template</a>
            </Button>
          )}
          {canEdit && card.archived && (
            <>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Recover ${card.title}`}
                onClick={onRestore}
              >
                <RotateCcw size={14} /> Recover
              </Button>
              <Button
                size="sm"
                variant="destructive"
                aria-label={`Permanently delete ${card.title}`}
                onClick={onDelete}
              >
                <Trash2 size={14} /> Delete permanently
              </Button>
            </>
          )}
        </div>
        {error && (
          <p className="catalog-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

export default function Home() {
  const { canEdit } = useApplicationAccess();
  const [cards, setCards] = useState<Card[]>([]),
    [showArchived, setShowArchived] = useState(false);
  const [pending, setPending] = useState<Card | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      templateJson<{ templates: TemplateSummary[] }>("/api/templates"),
      templateJson<{ templates: TemplateSummary[] }>(
        "/api/templates?archived=true",
      ),
    ]);
    const next: Card[] = [];
    for (const result of results)
      if (result.status === "fulfilled" && "templates" in result.value)
        for (const item of result.value.templates)
          next.push({
            id: item.id,
            title: item.title,
            archived: !!item.archived,
            url: `/templates/custom/${item.id}`,
            thumbnail: `${templateApiBase()}/api/templates/${item.id}/thumbnail`,
          });
    setCards(next);
    const failed = results.find((result) => result.status === "rejected");
    setError(
      failed?.status === "rejected"
        ? String(failed.reason?.message || "Could not load templates")
        : "",
    );
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  const archive = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await templateJson(
        pending.archived
          ? `/api/templates/${pending.id}/permanent?confirmed=true`
          : `/api/templates/${pending.id}`,
        {
          method: "DELETE",
        },
      );
      setPending(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not change template",
      );
    } finally {
      setBusy(false);
    }
  };
  const restore = async (card: Card) => {
    try {
      await templateJson(`/api/templates/${card.id}/restore`, {
        method: "POST",
      });
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not restore template",
      );
    }
  };
  const rename = async (card: Card, title: string) => {
    const init = {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    };
    await templateJson(`/api/templates/${card.id}`, init);
    await load();
  };
  return (
    <main className="catalog-shell">
      <header className="catalog-header">
        <div className="brand-mark">
          <FileText />
        </div>
        <div>
          <h1>Report Formatter</h1>
          <p>Choose a template to create or continue a report.</p>
        </div>
        {canEdit && <Button asChild>
          <a href="/templates/new">
            <Plus size={17} />
            Create new template
          </a>
        </Button>}
      </header>
      <section className="catalog-content">
        <div className="catalog-intro">
          <span className="eyebrow">TEMPLATE LIBRARY</span>
          <h2>Your report templates</h2>
          <p>Each template has its own drafts and report builder.</p>
        </div>
        <label className="template-check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived templates
        </label>
        <div className="template-grid">
          {cards
            .filter((card) => card.archived === showArchived)
            .map((card) => (
              <TemplateCard
                key={card.id}
                card={card}
                onArchive={() => setPending(card)}
                onRestore={() => void restore(card)}
                onDelete={() => setPending(card)}
                onRename={(title) => rename(card, title)}
              />
            ))}
        </div>
        {error && (
          <p className="catalog-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.archived
                ? "Permanently delete template?"
                : "Archive template?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.archived ? (
                <>
                  Permanently delete “{pending.title}” and ALL of its past
                  reports, uploaded images, and template versions? This action
                  cannot be undone in the application. Make a database backup
                  first if you want to keep previous records. Other templates
                  are not affected.
                </>
              ) : (
                <>
                  Remove “{pending?.title}” from the active template library?
                  Saved reports and photos will be retained. You can view them
                  or restore the template under Show archived templates.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant={pending?.archived ? "destructive" : "default"}
              disabled={busy}
              onClick={() => void archive()}
            >
              {busy
                ? "Working…"
                : pending?.archived
                  ? "Delete permanently"
                  : "Archive template"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
