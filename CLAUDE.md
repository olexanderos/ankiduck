# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

Ankiduck is a spaced-repetition flashcard web app (an Anki alternative). The primary target is running it as a standalone/installed PWA on iOS (iPhone 14), and it must be able to import `.apkg` deck files (Anki's export format) selected from the local iOS filesystem — there is no server-side import pipeline.

An `.apkg` file is a zip archive containing a SQLite database (`collection.anki2`/`.anki21`) plus media files. The dependencies already chosen in `package.json` point at the intended client-side pipeline:
- `fflate` — unzip the `.apkg` archive in-browser.
- `sql.js` — read the embedded SQLite collection database (via WASM) to extract decks/notes/cards.
- `idb` — persist parsed decks/cards/review state in IndexedDB for offline use as an installed PWA.

A sample deck, `Swedish 8k.apkg`, sits at the repo root for manual testing of the import flow.

## Current state

The codebase is currently the unmodified `create-vite` Svelte 5 + TypeScript template (`App.svelte`, `Counter.svelte`, demo assets). No app-specific logic, routing, apkg parsing, or IndexedDB persistence has been implemented yet — this is the starting scaffold for the project described above.

## Commands

- `npm run dev` — start the Vite dev server.
- `npm run build` — type-check (`svelte-check`) then production-build with Vite.
- `npm run preview` — serve the built `dist/` output locally.
- `npm run check` — type-check only, no build (`svelte-check` against `tsconfig.app.json` + `tsc` against `tsconfig.node.json`).

There is no lint script and no test runner configured yet.

## Architecture notes

- Build tooling: Vite 8 + `@sveltejs/vite-plugin-svelte`, Svelte 5, TypeScript ~6.0. Not a SvelteKit project — no built-in routing/SSR; it's a plain client-side Vite SPA (entry: `index.html` → `src/main.ts` → `src/App.svelte`).
- `svelte.config.js` and `vite.config.ts` are both at their template defaults.
- `tsconfig.json` is a references-only root; actual compiler options live in `tsconfig.app.json` (app/browser code, extends `@tsconfig/svelte`) and `tsconfig.node.json` (Vite config itself).
- Since `sql.js` runs SQLite via WASM in the browser and the app targets an installed iOS PWA, expect future work around: fetching/bundling the `sql.js` WASM asset, a service worker / web app manifest for "Add to Home Screen" installability, and a file-picker flow (e.g. `<input type="file">`) for loading `.apkg` files from the iOS Files app rather than any server upload.
