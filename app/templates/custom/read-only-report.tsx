"use client";
import { useEffect, useState } from "react";
import TemplatePdfViewer from "@/components/template-pdf-viewer";
import { Button } from "@/components/ui/button";
import {
  templateJson,
  templateRequest,
  downloadBlob,
  type CustomDraftDetail,
} from "@/lib/template-api";

export default function ReadOnlyReport({
  templateId,
  draftId,
}: {
  templateId: string;
  draftId: string;
}) {
  const [source, setSource] = useState<Uint8Array | null>(null),
    [title, setTitle] = useState("Saved report"),
    [error, setError] = useState("");
  const base = `/api/templates/${templateId}/drafts/${draftId}`;
  useEffect(() => {
    let active = true;
    void Promise.all([
      templateJson<CustomDraftDetail>(base),
      templateRequest(`${base}/pdf`).then((r) => r.arrayBuffer()),
    ])
      .then(([draft, bytes]) => {
        if (active) {
          setTitle(draft.title);
          setSource(new Uint8Array(bytes));
        }
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [base]);
  const download = async (format: string) => {
    try {
      const response = await templateRequest(
        `${base}/download?format=${format}`,
      );
      downloadBlob(
        await response.blob(),
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] || `${title}.pdf`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed");
    }
  };
  return (
    <main className="catalog-shell">
      <section className="catalog-content">
        <a href={`/templates/custom/${templateId}`}>← Saved reports</a>
        <h1>{title}</h1>
        <p>Read-only · Viewer access</p>
        <div className="template-toolbar">
          {["pdf", "docx", "original"].map((format) => (
            <Button
              key={format}
              variant="outline"
              onClick={() => void download(format)}
            >
              Download {format.toUpperCase()}
            </Button>
          ))}
        </div>
        {error && (
          <p role="alert" className="catalog-error">
            {error}
          </p>
        )}
        <TemplatePdfViewer source={source} />
      </section>
    </main>
  );
}
