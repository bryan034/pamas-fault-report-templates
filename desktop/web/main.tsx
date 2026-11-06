// The desktop app has no server rendering. These routes mirror the thin pages in
// app/ and render the same components; add any new page to both places.
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import "@/app/globals.css";
import { ApplicationAccess } from "@/components/application-access";
import Library from "@/app/page";
import LoginPage from "@/app/login/page";
import BuilderGate from "@/app/templates/new/builder-gate";
import EditorGate from "@/app/templates/custom/editor-gate";
import TemplateDraftLibrary from "@/app/templates/custom/template-draft-library";

const routes: [RegExp, (...parameters: string[]) => ReactNode][] = [
  [/^\/$/, () => <Library />],
  [/^\/login$/, () => <LoginPage />],
  [/^\/templates\/new$/, () => <BuilderGate />],
  [/^\/templates\/custom\/([^/]+)$/, id => <TemplateDraftLibrary templateId={id} />],
  [/^\/templates\/custom\/([^/]+)\/edit$/, id => <BuilderGate templateId={id} />],
  [/^\/templates\/custom\/([^/]+)\/new$/, id => <EditorGate templateId={id} draftId={null} />],
  [/^\/templates\/custom\/([^/]+)\/drafts\/([^/]+)$/, (id, draftId) => <EditorGate templateId={id} draftId={draftId} />],
];

function page(): ReactNode {
  const path = window.location.pathname.replace(/(.)\/$/, "$1");
  for (const [pattern, render] of routes) {
    const match = pattern.exec(path);
    if (match) return render(...match.slice(1).map(decodeURIComponent));
  }
  return <Library />;
}

createRoot(document.getElementById("root")!).render(<ApplicationAccess>{page()}</ApplicationAccess>);
