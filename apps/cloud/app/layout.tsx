import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ship Check Cloud",
  description: "Optional metadata history for local-first Ship Check assurance."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
