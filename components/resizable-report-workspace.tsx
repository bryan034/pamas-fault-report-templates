"use client";

import {
  Children,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";

export function revealSidebarField(
  workspace: HTMLElement | null,
  id: string | null,
) {
  if (!workspace) return;
  workspace
    .querySelectorAll<HTMLElement>("[data-sidebar-field]")
    .forEach((item) => {
      if (item.dataset.sidebarField === id) item.dataset.previewActive = "true";
      else item.removeAttribute("data-preview-active");
    });
  if (!id) return;
  const target = workspace.querySelector<HTMLElement>(
    `[data-sidebar-field="${CSS.escape(id)}"]`,
  );
  if (!target) return;
  // Scroll only the sidebar, never the PDF column or the whole document.
  const sidebar = target.closest<HTMLElement>(
    ".template-sidebar, .editor-panel",
  );
  if (!sidebar) return;
  const bounds = sidebar.getBoundingClientRect(),
    item = target.getBoundingClientRect();
  if (item.top < bounds.top + 12)
    sidebar.scrollBy({ top: item.top - bounds.top - 12, behavior: "smooth" });
  else if (item.bottom > bounds.bottom - 12)
    sidebar.scrollBy({
      top: item.bottom - bounds.bottom + 12,
      behavior: "smooth",
    });
}

export default function ResizableReportWorkspace({
  children,
  initialWidth = 370,
  workspaceRef,
}: {
  children: ReactNode;
  initialWidth?: number;
  workspaceRef?: Ref<HTMLDivElement>;
}) {
  const [width, setWidth] = useState(initialWidth);
  const root = useRef<HTMLDivElement | null>(null);
  const parts = Children.toArray(children);
  const maximum = () =>
    Math.max(260, Math.min(820, (root.current?.clientWidth || 1000) - 340));
  const resize = (next: number) =>
    setWidth(Math.round(Math.max(260, Math.min(maximum(), next))));
  return (
    <div
      ref={(element) => {
        root.current = element;
        if (typeof workspaceRef === "function") workspaceRef(element);
        else if (workspaceRef) workspaceRef.current = element;
      }}
      className="template-workspace report-workspace resizable-report-workspace"
      style={{ "--report-sidebar-width": `${width}px` } as CSSProperties}
    >
      {parts[0]}
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize report sidebar"
        aria-orientation="vertical"
        aria-valuemin={260}
        aria-valuemax={maximum()}
        aria-valuenow={width}
        className="report-sidebar-resizer"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (
            event.currentTarget.hasPointerCapture(event.pointerId) &&
            root.current
          )
            resize(event.clientX - root.current.getBoundingClientRect().left);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          resize(
            event.key === "Home"
              ? 260
              : event.key === "End"
                ? maximum()
                : width + (event.key === "ArrowLeft" ? -20 : 20),
          );
        }}
      >
        <span />
      </div>
      {parts[1]}
    </div>
  );
}
