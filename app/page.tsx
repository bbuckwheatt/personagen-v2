/**
 * app/page.tsx — Home page (React Server Component)
 *
 * This file is intentionally minimal. It renders the client component
 * PersonaGenApp which owns all the interactive state and hooks.
 *
 * WHY KEEP THIS AS AN RSC?
 * React Server Components have zero JavaScript footprint by default — they
 * render to HTML on the server and send no JS bundle to the client. By keeping
 * the page RSC and making PersonaGenApp the "use client" boundary, we ensure:
 * - The initial HTML arrives fast (server-rendered shell)
 * - JavaScript only loads for the interactive client component
 *
 * For this app there's no SEO-critical content or data fetching in the shell,
 * so the RSC vs client component distinction matters less here than in a data-
 * heavy app. But it's good practice to push the "use client" boundary as deep
 * as possible.
 */

import { PersonaGenApp } from "@/components/persona-gen-app";

export default function Home() {
  return (
    <main className="h-full">
      <PersonaGenApp />
    </main>
  );
}
