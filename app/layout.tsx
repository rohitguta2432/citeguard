import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CiteGuard - catch fake case citations before a judge does",
  description:
    "Paste a legal brief. CiteGuard checks every case citation against the free CourtListener database and flags the ones that do not exist.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
