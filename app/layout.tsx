import type { Metadata } from "next";
import "./globals.css";
import { ApplicationAccess } from "@/components/application-access";

export const metadata: Metadata = {
  title: "PAMAS",
  description: "Choose report templates, manage drafts, and generate calibrated PDF reports.",
  icons: {
    icon: "/pamas-logo.png",
    shortcut: "/pamas-logo.png",
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
