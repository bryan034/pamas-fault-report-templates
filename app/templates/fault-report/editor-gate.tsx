"use client";

import dynamic from "next/dynamic";

const FaultReportEditor = dynamic(() => import("./editor"), { ssr: false, loading: () => <main className="list-state">Opening report editor…</main> });

export default function EditorGate({ draftId }: { draftId: string | null }) {
  return <FaultReportEditor draftId={draftId} />;
}
