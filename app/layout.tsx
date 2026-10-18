import type { Metadata } from "next";
import "./globals.css";
import { ApplicationAccess } from "@/components/application-access";

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
      <body className="antialiased"><ApplicationAccess>{children}</ApplicationAccess></body>
    </html>
  );
}
