import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
