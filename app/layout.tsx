import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Report Formatter",
  description: "Choose report templates, manage drafts, and generate calibrated PDF reports.",
  other: {
    "codex-preview": "fault-report-generator",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
