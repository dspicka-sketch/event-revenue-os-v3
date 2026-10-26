import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Executive OS",
  description: "AI operating system: executive assistant, inbox triage, tasks and daily briefing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
