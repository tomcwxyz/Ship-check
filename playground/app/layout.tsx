import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const siteUrl = "https://check.good-ship.co.uk";
const title = "Ship Check Playground | Free GitHub & Website Security Checks";
const description =
  "Scan a public GitHub repository or website for security findings, unanswered questions and coverage. Free, no sign-in. Know what to check before you ship.";
const isProduction = process.env.VERCEL_ENV === "production";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Ship Check Playground",
  title,
  description,
  alternates: { canonical: "/" },
  robots: isProduction
    ? {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          "max-image-preview": "large",
          "max-snippet": -1,
          "max-video-preview": -1
        }
      }
    : { index: false, follow: false, nocache: true },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: siteUrl,
    siteName: "Ship Check",
    title: "Ship Check Playground — Before you ship, check.",
    description,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Ship Check Playground: Before you ship, check. Findings, to verify and coverage."
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Ship Check Playground — Before you ship, check.",
    description,
    images: ["/opengraph-image"]
  },
  category: "technology",
  creator: "The Good Ship"
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Ship Check Playground",
  url: siteUrl,
  description,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  isAccessibleForFree: true,
  publisher: {
    "@type": "Organization",
    name: "The Good Ship",
    url: "https://good-ship.co.uk"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB">
    <body>
      <Script src="https://good-ship.co.uk/analytics/browser.js" strategy="afterInteractive" />
      {children}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c")
        }}
      />
    </body>
  </html>;
}
