import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ship Check — Before you ship, check",
  description: "A free, no-login playground for evidence-led checks on public GitHub repositories and live websites.",
  robots: { index: false, follow: false }
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
