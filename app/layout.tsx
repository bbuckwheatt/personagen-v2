import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PersonaGen",
  description: "AI chatbot persona generator powered by LangGraph",
};

/**
 * RootLayout — the outermost shell for every page.
 *
 * This is a React Server Component (no "use client" directive). It runs on
 * the server and renders the static HTML <html> + <body> tags. No JavaScript
 * is sent to the browser just for this wrapper — JS only arrives for the
 * client components nested inside (like PersonaGenApp).
 *
 * The `h-full` on both html and body + `overflow-hidden` on body ensures the
 * three-panel layout fills exactly the viewport height without a scrollbar on
 * the outer page. Each panel manages its own internal scrolling.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
