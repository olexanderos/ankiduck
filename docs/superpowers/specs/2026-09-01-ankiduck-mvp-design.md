# Ankiduck MVP Design

Date: 2026-09-01
Status: Approved for implementation planning

## Purpose

Ankiduck is a spaced-repetition flashcard PWA that installs to an iPhone home
screen and imports Anki `.apkg` deck files entirely client-side — no backend,
no server-side import pipeline, no account/auth. This spec covers the MVP:
import, storage, scheduling, review, and offline installability.

## Non-goals (MVP)

- Multi-device sync.
- Writing changes back to the original `.apkg` file.
- Importing full Anki review history (the `revlog` table).
- Account/auth of any kind.
- Card browsing/editing after import.
- Per-deck daily new-card/review limits (Anki's "cards/day" pacing).

## Known issue: sample fixture is corrupted

`Swedish 8k.apkg` at the repo root (34,837,435 bytes) is **not a valid zip
archive** — it has a well-formed local file header and central directory
records, but no End-of-Central-Directory record at all. Confirmed with
`unzip`, `zipinfo`, and Python's `zipfile` module, all of which fail to open
it. The central directory that is present shows the archive contains
`collection.anki2` (legacy schema, JSON blobs for decks/models — no
`collection.anki21` or `.anki21b`) plus a `media` manifest, which is useful
for grounding the parser design below, but the file itself needs to be
re-exported or re-downloaded before it can be used for real manual testing.
This does not block implementation (a small hand-built SQLite fixture will
be used for automated tests instead — see Testing), but should be resolved
before end-to-end manual verification.

## Architecture

```
src/
  workers/import.worker.ts    — unzip, sql.js parse, template/media extraction (all off main thread)
  lib/apkg/                   — pure parsing logic used by the worker: zip reading, schema detection,
                                 collection.anki2/.anki21 SQL queries, media manifest decoding
  lib/db/                     — idb wrapper: schema, CRUD, the only code that touches IndexedDB
  lib/template/               — Anki template renderer (mustache-subset + conditionals + cloze) + CSS injection
  lib/scheduler/               — Anki-style SM-2: state transitions, due-card queries
  lib/stores/                 — Svelte 5 runes-based app state (current deck tree, active review queue)
  App.svelte                  — owns view switching between the 3 top-level views (no router needed)
  DeckList.svelte             — collapsible deck tree, import button, delete action
  Review.svelte                — card display, reveal, grade buttons, audio
  ImportProgress.svelte        — shown while the worker is processing a file
public/
  sql-wasm.wasm                — sql.js WASM binary, precached by the service worker
```

The worker is the only place `fflate` and `sql.js` run. It receives a `File`
and returns a plain-object payload (decks, note types/templates, notes,
cards, media blob map) over `postMessage`; the main thread's job is to
persist that payload via `lib/db` and drive progress UI. Parsing logic is
pure functions in `lib/apkg/`, testable without a real worker.

## Import pipeline

1. User taps **Import** → `<input type="file" accept=".apkg">` → the
   selected `File` is handed to `import.worker.ts` via `postMessage` (the
   `File` transfers directly, no copy needed).
2. **Unzip** with `fflate`, reading `collection.anki21` if present, else
   `collection.anki2`. If only `collection.anki21b` (zstd-compressed) is
   present, fail with a clear message: "this deck uses a newer compressed
   format Ankiduck doesn't support yet — re-export from Anki with 'Support
   older Anki versions' checked."
3. **Load into sql.js**: the collection SQLite file's bytes go directly into
   a new `sql.js` `Database`.
4. **Schema detection & extraction**, normalized to one internal shape
   regardless of source schema:
   - Legacy (`anki2`): `SELECT decks, models FROM col` → parse the JSON
     blobs for deck names/hierarchy and note-type templates/fields/CSS.
     Notes/cards come from the `notes`/`cards` tables.
   - Modern (`anki21`, detected by the presence of a `notetypes` table
     rather than a specific schema version number, which varies across Anki
     releases): decks/models come from the normalized
     `decks`/`notetypes`/`templates`/`fields` tables instead of JSON blobs.
5. **Media**: read the zip's `media` file (JSON mapping `"0", "1", ...` to
   real filenames), pull each numbered zip entry as a `Blob` keyed by its
   real filename.
6. Worker posts back `{ decks, noteTypes, notes, cards, media }` plus
   incremental progress events (`{ phase: 'unzipping' | 'parsing' |
   'extracting-media', pct }`).
7. Main thread runs the **merge** into IndexedDB (see Storage schema),
   applying the user's chosen reset-scheduling-or-not toggle, presented on
   the import screen at the time of import (not a fixed global setting).

**Error handling**: corrupt zip, missing collection file, unsupported
schema, or a SQL query failure all surface as one friendly error screen with
the underlying message expandable for debugging. Import is atomic from the
user's perspective — nothing is written to IndexedDB until parsing fully
succeeds.

**Re-import behavior**: additive. A second import (of a different or the
same apkg) adds new decks/notes/cards alongside existing ones. Re-importing
a previously-imported apkg upserts existing `decks`/`noteTypes`/`notes`/
`cards` by their Anki-assigned IDs (`did`/`mid`/`nid`/`cid`) rather than
duplicating them.

## Storage schema (IndexedDB via `idb`)

| Store | Key | Fields | Notes |
|---|---|---|---|
| `decks` | `did` | `name`, `parentPath[]` (derived by splitting on `::`), `deleted?` | Tree built client-side from `parentPath` at render time. |
| `noteTypes` | `mid` | `name`, `fields[]`, `templates[]` (`{name, qfmt, afmt}`), `css` | Overwritten on re-import of the same `mid`. |
| `notes` | `nid` | `mid`, `fields[]`, `guid` | `guid` retained for future content-based dedupe; unused in MVP logic. |
| `cards` | `cid` | `nid`, `did`, `ord` (template index within the note type) | Links a note to a specific deck + template. |
| `cardState` | `cid` | `queue` (`'new'\|'learning'\|'review'\|'relearning'`), `due` (ms timestamp), `ivl`, `ease`, `lapses`, `learningStep` | Ankiduck's own scheduling state, deliberately separate from `cards` so re-importing content never clobbers progress. |
| `media` | `filename` | `blob` | Referenced by filename from rendered template HTML; orphan-swept on deck delete. |

**Merge/upsert rule**: `decks`/`noteTypes`/`notes`/`cards` are upserted by
Anki ID on every import. `cardState` rows are only created fresh if none
exists yet for that `cid` — *unless* the user selected "reset scheduling"
for that specific import, which force-overwrites existing `cardState` to
the `'new'` state.

**Deck deletion**: removes the deck and all its notes/cards/`cardState` rows
recursively (including subdecks), then sweeps `media` entries no longer
referenced by any remaining card. Confirmation required in the UI.

## Template rendering engine (`lib/template/`)

A small interpreter over Anki's template syntax (not a regex hack), scoped
entirely to pure functions — `renderCard(note, template, mediaMap) →
{front, back}` HTML strings — independently unit-testable with no DOM,
worker, or IndexedDB involved.

Supported syntax:
- `{{FieldName}}` — HTML-escaped field value substitution.
- `{{text:FieldName}}` — field value with HTML stripped first.
- `{{#FieldName}}...{{/FieldName}}` / `{{^FieldName}}...{{/FieldName}}` —
  conditional sections (render if field is non-empty / empty).
- `{{FrontSide}}` on answer templates — the fully-rendered front output.
- `{{cloze:FieldName}}` on cloze note types — parses `{{c1::text::hint}}`
  spans; the active cloze number renders as a blank on the question side and
  revealed on the answer side, other cloze numbers render as plain text.
- Note type `css` is injected scoped to the review card container (a
  wrapping class, no shadow DOM) so it can't leak into app chrome.
- `[sound:filename]` tokens anywhere in rendered HTML are extracted and
  replaced with an audio-control element resolving to an object URL from the
  `media` store; `<img src="filename">` `src` attributes are rewritten the
  same way.

## Scheduler (`lib/scheduler/`) — Anki-style SM-2

Pure state machine: `nextState(cardState, grade) → newCardState`. Four
queues: `new → learning → review`, with `review → relearning → review` on
lapse.

- **Learning** (default steps `[1m, 10m]`):
  - *Again* — reset to step 0.
  - *Hard* — repeat the current step.
  - *Good* — advance to the next step; graduate to `review` (`ivl` = 1 day,
    `ease` = 2.5) once the last step passes.
  - *Easy* — graduate immediately (`ivl` = 4 days, `ease` = 2.5).
- **Review** (`ivl` in days, `ease` starting at 2.5):
  - *Again* — `lapses += 1`, `ease -= 0.2` (floor 1.3), drops into
    **relearning** (steps `[10m]`) with `ivl` reset toward 0; graduates
    back to `review` using that reduced `ivl` once relearning completes.
  - *Hard* — `ivl *= 1.2`, `ease -= 0.15`.
  - *Good* — `ivl *= ease`.
  - *Easy* — `ivl *= ease * 1.3`, `ease += 0.15`.
  - Small ±5% fuzz applied to day-granularity intervals to avoid cards
    clumping on the same due day.
- `due` is stored as a plain millisecond timestamp uniformly for both
  sub-day (learning/relearning) and day-granularity (review) cards —
  simpler than Anki's internal day-index scheme; `due <= now` works as the
  query in both cases.
- Grade buttons display the resulting interval as a preview (e.g. "10m ·
  1d · 3d · 6d"), matching familiar Anki UX.

## Review UI/session flow

- **`DeckList.svelte`**: nested `::`-derived hierarchy, collapsible groups,
  each row showing new/learning/due counts rolled up from its subtree.
  Import button and per-deck delete (with confirmation) live here.
- Tapping a deck builds a **session queue** scoped to it and all subdecks:
  due learning/relearning cards (soonest-due first) → due review cards →
  new cards (creation order). No daily caps — the queue is simply
  everything currently eligible.
- **`Review.svelte`**: renders the front via the template engine; "Show
  Answer" reveals the back — this tap is the user gesture that unlocks
  audio autoplay for that card's audio, with a visible replay button as
  fallback. The 4 grade buttons (Again/Hard/Good/Easy) appear after reveal,
  each showing its resulting interval. Grading writes the new `cardState`
  and advances the queue.
- Empty queue → an "all done" screen, back to the deck list.

## PWA setup

- Add `vite-plugin-pwa` (currently absent from `package.json` despite being
  referenced in project docs) in `generateSW` mode: precache the app shell,
  JS/CSS bundles, and `sql-wasm.wasm` so import works fully offline after
  the first load.
- Manifest: `display: "standalone"`, portrait orientation, theme/background
  colors, icons at the sizes iOS needs for home-screen/apple-touch-icon
  (192/512px PNGs — new icon assets required; the existing
  `public/favicon.svg` alone isn't sufficient for iOS home-screen icons).
- iOS specifics: safe-area-inset padding for the iPhone 14's notch/home
  indicator, `apple-mobile-web-app-capable` meta tag, disabled
  pinch-zoom/bounce-scroll on the review view for an app-like feel.
- Caching strategy: cache-first for the shell/wasm — there is no backend and
  nothing ever needs network, so the service worker's only job is making
  the initial asset set durable offline.

## Error handling summary

- Corrupt/unsupported `.apkg` → friendly error screen with expandable
  technical detail (Import pipeline section).
- IndexedDB quota exceeded during import → caught and surfaced; media-heavy
  decks can be tens of MB.
- Missing/unplayable media file at review time → render a broken-media
  placeholder rather than failing the card.

## Testing strategy

No test runner is currently configured. Add **Vitest** (pairs naturally
with Vite) for unit tests on the three pure-logic modules that carry the
real risk of subtle bugs:

- `lib/scheduler` — state transitions per grade, across all four queues.
- `lib/template` — rendering conditionals/cloze/media substitution against
  fixture note types.
- `lib/apkg` — schema parsing against a small hand-built SQLite fixture
  (the real sample file is corrupted — see "Known issue" above).

No component or E2E test framework for MVP. UI is verified manually
on-device, per the project's existing guidance to test real functionality
in-browser rather than relying solely on type-checking.
