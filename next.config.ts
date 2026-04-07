/**
 * next.config.ts — Next.js configuration
 *
 * The main thing we configure here is the maximum function duration for the
 * API route, which requires the serverExternalPackages option to properly
 * bundle LangGraph.js dependencies.
 *
 * serverExternalPackages:
 * Next.js bundles server-side code by default (good for smaller deployments).
 * But some packages use native Node.js features (dynamic require, __dirname,
 * native modules) that break when bundled. LangGraph.js and LangChain fall
 * into this category — we mark them as external so Next.js imports them
 * at runtime from node_modules instead of bundling them.
 *
 * WHY DOES THIS MATTER?
 * Without this, you'd get "Module not found" errors at runtime for packages
 * that use dynamic imports or conditional requires that webpack can't resolve
 * at build time.
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark LangChain/LangGraph packages as external to avoid bundling issues.
  // These packages use dynamic requires and native Node.js features that
  // don't survive webpack bundling.
  serverExternalPackages: [
    "@langchain/core",
    "@langchain/langgraph",
    "@langchain/openai",
    "@langchain/anthropic",
  ],

  // Explicitly set the Turbopack workspace root to this project directory.
  // Without this, Next.js traverses up to find a lockfile and may pick the
  // wrong parent directory if there are multiple lockfiles in ancestor directories.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
