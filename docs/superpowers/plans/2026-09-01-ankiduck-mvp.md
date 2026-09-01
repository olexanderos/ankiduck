# Ankiduck MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Ankiduck end-to-end: import an Anki `.apkg` file entirely client-side, store it in IndexedDB, review cards with an Anki-style SM-2 scheduler, and install as an offline iOS PWA.

**Architecture:** A dedicated Web Worker (`workers/import.worker.ts`) does all unzip/SQLite/media-extraction work and hands a plain-object payload back to the main thread, which is the only place IndexedDB is touched (`lib/db/`). Card rendering (`lib/template/`) and scheduling (`lib/scheduler/`) are pure, dependency-free logic modules. Three Svelte views (deck list, import progress, review) are switched by a small runes-based store — no router.

**Tech Stack:** Vite 8, Svelte 5 (runes), TypeScript, `fflate` (unzip), `sql.js` (SQLite via WASM), `idb` (IndexedDB), `vite-plugin-pwa` (manifest + service worker), Vitest (unit tests), `fake-indexeddb` (IndexedDB polyfill for tests), `pngjs` (icon generation script).

**Spec:** `docs/superpowers/specs/2026-09-01-ankiduck-mvp-design.md`

## Global Constraints

- Import scheduling reset is a **per-import user choice** presented on the import screen, not a fixed global setting.
- Re-import is **additive with upsert-by-Anki-ID** dedupe (`did`/`mid`/`nid`/`cid`); `cardState` rows are only created fresh if absent, unless the user chose "reset scheduling" for that import.
- MVP fully supports only the **legacy `collection.anki2` schema** (JSON blobs in the `col` table, detected by the *absence* of a `notetypes` table). Modern schema (`collection.anki21`, presence of a `notetypes` table) uses protobuf-encoded note-type config and is an **explicit unsupported-format error** for MVP, same treatment as zstd-compressed `collection.anki21b`.
- No per-deck daily new-card/review limits. A review session queue is simply everything currently eligible: due learning/relearning → due review → new, in that order.
- 4-button grading (Again/Hard/Good/Easy) with Anki-standard learning steps `[1m, 10m]`, relearning steps `[10m]`, starting ease `2.5`, ease floor `1.3`.
- Deck hierarchy is a collapsible tree built from splitting deck names on `::`.
- Audio autoplays on answer reveal (the reveal tap is the unlocking user gesture) with a visible replay control as fallback.
- Deck deletion cascades to that deck's notes/cards/`cardState` (and subdecks), then sweeps orphaned media.
- No component or E2E test framework. `lib/template`, `lib/scheduler`, `lib/apkg`, and `lib/db` get Vitest unit tests (the last three run against `fake-indexeddb`/`sql.js`'s Node build). UI (`App.svelte`, `DeckList.svelte`, `Review.svelte`, `ImportProgress.svelte`) and the worker/controller integration are verified manually via `npm run dev`, per spec.
- The sample fixture `Swedish 8k.apkg` at the repo root is a **corrupted zip** (no End-of-Central-Directory record) — do not use it as a test fixture; automated apkg-parsing tests use a hand-built fixture (Task 11). It needs a fresh re-export/re-download before it's usable for the manual verification task at the end of this plan.

---

## Task 1: Project setup — testing, PWA, and icon-generation dependencies

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `npm run test` (Vitest, single run), `npm run test:watch` (Vitest watch mode). All later tasks' test steps assume these scripts exist.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev vitest@^3.2.0 fake-indexeddb@^6.0.0 vite-plugin-pwa@^0.21.2 pngjs@^7.0.0 @types/pngjs@^6.0.5
```

- [ ] **Step 2: Add test scripts to `package.json`**

Add to the `"scripts"` object (alongside the existing `dev`/`build`/`preview`/`check`):

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Verify the test runner works with no tests yet**

Run: `npm run test`
Expected: Vitest reports "No test files found" (or passes with 0 tests) — exits without error, confirming the harness is wired up before any real tests are added.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "Add Vitest, fake-indexeddb, vite-plugin-pwa, pngjs dependencies"
```

---

## Task 2: Domain types

**Files:**
- Create: `src/lib/types.ts`

**Interfaces:**
- Produces: `Grade`, `Queue`, `Deck`, `NoteTypeTemplate`, `NoteType`, `Note`, `Card`, `CardState`, `MediaFile`, `ParsedApkg` — every later task imports its data shapes from this file.

- [ ] **Step 1: Write the types file**

```ts
// src/lib/types.ts

export type Grade = 'again' | 'hard' | 'good' | 'easy';
export type Queue = 'new' | 'learning' | 'review' | 'relearning';

export interface Deck {
  did: number;
  name: string; // raw Anki deck name, e.g. "Swedish 8k::Verbs::Irregular"
  pathSegments: string[]; // name.split('::')
}

export interface NoteTypeTemplate {
  name: string;
  qfmt: string;
  afmt: string;
}

export interface NoteType {
  mid: number;
  name: string;
  fields: string[]; // field names, in order
  templates: NoteTypeTemplate[];
  css: string;
  isCloze: boolean;
}

export interface Note {
  nid: number;
  mid: number;
  guid: string;
  fields: string[]; // values, ordered to match NoteType.fields
}

export interface Card {
  cid: number;
  nid: number;
  did: number;
  ord: number; // index into the note type's templates array
}

export interface CardState {
  cid: number;
  queue: Queue;
  due: number; // ms timestamp
  ivl: number; // days (0 while in learning/relearning)
  ease: number;
  lapses: number;
  learningStep: number; // index into the active learning/relearning steps array
}

export interface MediaFile {
  filename: string;
  blob: Blob;
}

export interface ParsedApkg {
  decks: Deck[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  media: MediaFile[];
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: PASS (no errors) — this file has no logic to test, just type-checking.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "Add Ankiduck domain types"
```

---

## Task 3: Template engine — field substitution

**Files:**
- Create: `src/lib/template/render.ts`
- Test: `src/lib/template/render.test.ts`

**Interfaces:**
- Consumes: nothing (first template-engine task).
- Produces: `escapeHtml(s: string): string` (exported for reuse, though field substitution itself does not escape — see note below), `substituteFields(template: string, fields: Record<string, string>): string`. Later template tasks (4-7) extend this same file.

Note on fidelity: Anki field values are already-formatted HTML (the user's rich-text editor output), so `{{Field}}` inserts them **unescaped** — that's how Anki actually renders `<b>bold</b>` typed into a field. Only `{{text:Field}}` differs, by stripping tags first.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/template/render.test.ts
import { describe, it, expect } from 'vitest';
import { substituteFields } from './render';

describe('substituteFields', () => {
  it('substitutes a plain field', () => {
    expect(substituteFields('{{Front}}', { Front: 'hej' })).toBe('hej');
  });

  it('inserts field HTML unescaped', () => {
    expect(substituteFields('{{Front}}', { Front: '<b>hej</b>' })).toBe('<b>hej</b>');
  });

  it('substitutes multiple distinct fields', () => {
    expect(substituteFields('{{Front}} - {{Back}}', { Front: 'a', Back: 'b' })).toBe('a - b');
  });

  it('renders empty string for a missing field', () => {
    expect(substituteFields('{{Missing}}', {})).toBe('');
  });

  it('strips HTML tags for {{text:Field}}', () => {
    expect(substituteFields('{{text:Front}}', { Front: '<b>hej</b> då' })).toBe('hej då');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `src/lib/template/render.ts` does not exist yet.

- [ ] **Step 3: Implement `substituteFields`**

```ts
// src/lib/template/render.ts

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function substituteFields(template: string, fields: Record<string, string>): string {
  return template
    .replace(/\{\{text:(\w+)\}\}/g, (_match, name: string) => {
      const raw = fields[name] ?? '';
      return raw.replace(/<[^>]*>/g, '');
    })
    .replace(/\{\{(\w+)\}\}/g, (_match, name: string) => fields[name] ?? '');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/template/render.ts src/lib/template/render.test.ts
git commit -m "Add template engine: field substitution"
```

---

## Task 4: Template engine — conditional sections

**Files:**
- Modify: `src/lib/template/render.ts`
- Modify: `src/lib/template/render.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `applyConditionals(template: string, fields: Record<string, string>): string`.

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/template/render.test.ts`:

```ts
import { applyConditionals } from './render';

describe('applyConditionals', () => {
  it('keeps a {{#Field}} section when the field is non-empty', () => {
    expect(applyConditionals('{{#Front}}shown{{/Front}}', { Front: 'x' })).toBe('shown');
  });

  it('drops a {{#Field}} section when the field is empty', () => {
    expect(applyConditionals('{{#Front}}shown{{/Front}}', { Front: '' })).toBe('');
  });

  it('drops a {{#Field}} section when the field is missing', () => {
    expect(applyConditionals('{{#Front}}shown{{/Front}}', {})).toBe('');
  });

  it('keeps a {{^Field}} section when the field is empty', () => {
    expect(applyConditionals('{{^Front}}shown{{/Front}}', { Front: '' })).toBe('shown');
  });

  it('drops a {{^Field}} section when the field is non-empty', () => {
    expect(applyConditionals('{{^Front}}shown{{/Front}}', { Front: 'x' })).toBe('');
  });

  it('handles two independent conditional sections', () => {
    const tpl = '{{#A}}a{{/A}}{{#B}}b{{/B}}';
    expect(applyConditionals(tpl, { A: '1', B: '' })).toBe('a');
  });

  it('preserves surrounding text outside the conditional', () => {
    expect(applyConditionals('before {{#A}}mid{{/A}} after', { A: '1' })).toBe('before mid after');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `applyConditionals` is not exported.

- [ ] **Step 3: Implement `applyConditionals`**

Append to `src/lib/template/render.ts`:

```ts
export function applyConditionals(template: string, fields: Record<string, string>): string {
  const conditionalRe = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/;
  let result = template;
  let match: RegExpExecArray | null;
  while ((match = conditionalRe.exec(result))) {
    const [full, kind, fieldName, inner] = match;
    const value = fields[fieldName] ?? '';
    const isEmpty = value.trim() === '';
    const keep = kind === '#' ? !isEmpty : isEmpty;
    result = result.slice(0, match.index) + (keep ? inner : '') + result.slice(match.index + full.length);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (12 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/lib/template/render.ts src/lib/template/render.test.ts
git commit -m "Add template engine: conditional sections"
```

---

## Task 5: Template engine — cloze rendering

**Files:**
- Modify: `src/lib/template/render.ts`
- Modify: `src/lib/template/render.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `renderCloze(fieldValue: string, activeClozeNumber: number, revealAnswer: boolean): string`, `substituteCloze(template: string, fields: Record<string, string>, cardOrd: number, revealAnswer: boolean): string`.

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/template/render.test.ts`:

```ts
import { renderCloze, substituteCloze } from './render';

describe('renderCloze', () => {
  it('blanks the active cloze when not revealing', () => {
    expect(renderCloze('{{c1::Paris}} is the capital', 1, false)).toBe(
      '<span class="cloze">[...]</span> is the capital'
    );
  });

  it('reveals the active cloze when revealing', () => {
    expect(renderCloze('{{c1::Paris}} is the capital', 1, true)).toBe(
      '<span class="cloze">Paris</span> is the capital'
    );
  });

  it('uses the hint text in place of "..." when blanked', () => {
    expect(renderCloze('{{c1::Paris::city}} is the capital', 1, false)).toBe(
      '<span class="cloze">[city]</span> is the capital'
    );
  });

  it('always reveals clozes that are not the active number', () => {
    expect(renderCloze('{{c1::Paris}} is in {{c2::France}}', 1, false)).toBe(
      '<span class="cloze">[...]</span> is in France'
    );
  });
});

describe('substituteCloze', () => {
  it('resolves a {{cloze:Field}} token using cardOrd + 1 as the active cloze number', () => {
    const result = substituteCloze('{{cloze:Text}}', { Text: '{{c2::Paris}}' }, 1, true);
    expect(result).toBe('<span class="cloze">Paris</span>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `renderCloze`/`substituteCloze` not exported.

- [ ] **Step 3: Implement cloze rendering**

Append to `src/lib/template/render.ts`:

```ts
const CLOZE_RE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/gs;

export function renderCloze(fieldValue: string, activeClozeNumber: number, revealAnswer: boolean): string {
  return fieldValue.replace(CLOZE_RE, (_match, numStr: string, text: string, hint: string | undefined) => {
    const num = Number(numStr);
    if (num !== activeClozeNumber) return text;
    if (revealAnswer) return `<span class="cloze">${text}</span>`;
    return `<span class="cloze">[${hint ?? '...'}]</span>`;
  });
}

export function substituteCloze(
  template: string,
  fields: Record<string, string>,
  cardOrd: number,
  revealAnswer: boolean
): string {
  return template.replace(/\{\{cloze:(\w+)\}\}/g, (_match, name: string) => {
    const raw = fields[name] ?? '';
    return renderCloze(raw, cardOrd + 1, revealAnswer);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (17 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/lib/template/render.ts src/lib/template/render.test.ts
git commit -m "Add template engine: cloze rendering"
```

---

## Task 6: Template engine — media rewriting, CSS scoping, and full card rendering

**Files:**
- Modify: `src/lib/template/render.ts`
- Modify: `src/lib/template/render.test.ts`

**Interfaces:**
- Consumes: `substituteFields`, `applyConditionals`, `substituteCloze` (Tasks 3-5); `Note`, `NoteType` from `src/lib/types.ts` (Task 2).
- Produces: `rewriteMediaTokens(html: string, mediaUrlMap: Map<string, string>): string`, `wrapWithCss(html: string, css: string): string`, `renderTemplateString(template: string, fields: Record<string, string>, opts: { cardOrd: number; revealAnswer: boolean }): string`, `renderCard(note: Note, noteType: NoteType, cardOrd: number, mediaUrlMap: Map<string, string>): { front: string; back: string }`. `renderCard` is what `Review.svelte` (Task 23) calls directly.

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/template/render.test.ts`:

```ts
import { rewriteMediaTokens, wrapWithCss, renderTemplateString, renderCard } from './render';
import type { Note, NoteType } from '../types';

describe('rewriteMediaTokens', () => {
  it('replaces a [sound:] token with an audio element pointing at the resolved URL', () => {
    const map = new Map([['hej.mp3', 'blob:abc']]);
    expect(rewriteMediaTokens('[sound:hej.mp3]', map)).toBe(
      '<audio class="ankiduck-audio" data-autoplay="true" controls src="blob:abc"></audio>'
    );
  });

  it('drops a [sound:] token whose file is not in the media map', () => {
    expect(rewriteMediaTokens('[sound:missing.mp3]', new Map())).toBe('');
  });

  it('rewrites an <img src> to the resolved URL', () => {
    const map = new Map([['cat.png', 'blob:xyz']]);
    expect(rewriteMediaTokens('<img src="cat.png">', map)).toBe('<img src="blob:xyz">');
  });
});

describe('wrapWithCss', () => {
  it('scopes .card selectors to .ankiduck-card and wraps the content', () => {
    const result = wrapWithCss('hello', '.card { color: red; }');
    expect(result).toBe('<style>.ankiduck-card { color: red; }</style><div class="ankiduck-card">hello</div>');
  });
});

describe('renderTemplateString', () => {
  it('applies cloze, then conditionals, then field substitution in order', () => {
    const result = renderTemplateString(
      '{{#Extra}}{{Extra}}{{/Extra}}{{cloze:Text}}',
      { Text: '{{c1::Paris}}', Extra: 'note' },
      { cardOrd: 0, revealAnswer: true }
    );
    expect(result).toBe('note<span class="cloze">Paris</span>');
  });
});

describe('renderCard', () => {
  const noteType: NoteType = {
    mid: 1,
    name: 'Basic',
    fields: ['Front', 'Back'],
    templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }],
    css: '.card { color: black; }',
    isCloze: false,
  };
  const note: Note = { nid: 1, mid: 1, guid: 'g1', fields: ['hej', 'hello'] };

  it('renders the front from qfmt', () => {
    const { front } = renderCard(note, noteType, 0, new Map());
    expect(front).toContain('hej');
    expect(front).not.toContain('hello');
  });

  it('renders the back with FrontSide composed in', () => {
    const { back } = renderCard(note, noteType, 0, new Map());
    expect(back).toContain('hej');
    expect(back).toContain('<hr>');
    expect(back).toContain('hello');
  });

  it('wraps both sides in the note type CSS', () => {
    const { front } = renderCard(note, noteType, 0, new Map());
    expect(front).toContain('<style>.ankiduck-card { color: black; }</style>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — new exports don't exist yet.

- [ ] **Step 3: Implement media rewriting, CSS scoping, and `renderCard`**

Append to `src/lib/template/render.ts`:

```ts
import type { Note, NoteType } from '../types';

const SOUND_RE = /\[sound:([^\]]+)\]/g;
const IMG_SRC_RE = /<img([^>]*)\ssrc="([^"]+)"/g;

export function rewriteMediaTokens(html: string, mediaUrlMap: Map<string, string>): string {
  let result = html.replace(SOUND_RE, (_match, filename: string) => {
    const url = mediaUrlMap.get(filename);
    if (!url) return '';
    return `<audio class="ankiduck-audio" data-autoplay="true" controls src="${url}"></audio>`;
  });
  result = result.replace(IMG_SRC_RE, (full: string, attrs: string, src: string) => {
    const url = mediaUrlMap.get(src);
    return url ? `<img${attrs} src="${url}"` : full;
  });
  return result;
}

export function wrapWithCss(html: string, css: string): string {
  const scopedCss = css.replace(/\.card\b/g, '.ankiduck-card');
  return `<style>${scopedCss}</style><div class="ankiduck-card">${html}</div>`;
}

export function renderTemplateString(
  template: string,
  fields: Record<string, string>,
  opts: { cardOrd: number; revealAnswer: boolean }
): string {
  let result = substituteCloze(template, fields, opts.cardOrd, opts.revealAnswer);
  result = applyConditionals(result, fields);
  result = substituteFields(result, fields);
  return result;
}

export function renderCard(
  note: Note,
  noteType: NoteType,
  cardOrd: number,
  mediaUrlMap: Map<string, string>
): { front: string; back: string } {
  const fieldMap: Record<string, string> = {};
  noteType.fields.forEach((name, i) => {
    fieldMap[name] = note.fields[i] ?? '';
  });

  const template = noteType.templates[cardOrd];
  const frontRaw = renderTemplateString(template.qfmt, fieldMap, { cardOrd, revealAnswer: false });
  const backRaw = renderTemplateString(
    template.afmt,
    { ...fieldMap, FrontSide: frontRaw },
    { cardOrd, revealAnswer: true }
  );

  const front = wrapWithCss(rewriteMediaTokens(frontRaw, mediaUrlMap), noteType.css);
  const back = wrapWithCss(rewriteMediaTokens(backRaw, mediaUrlMap), noteType.css);
  return { front, back };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (23 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/lib/template/render.ts src/lib/template/render.test.ts
git commit -m "Add template engine: media rewriting, CSS scoping, renderCard"
```

---

## Task 7: Scheduler — learning-queue transitions

**Files:**
- Create: `src/lib/scheduler/schedule.ts`
- Test: `src/lib/scheduler/schedule.test.ts`

**Interfaces:**
- Consumes: `Grade`, `Queue`, `CardState` from `src/lib/types.ts` (Task 2).
- Produces: `LEARNING_STEPS_MIN`, `RELEARNING_STEPS_MIN`, `GRADUATING_IVL_DAYS`, `EASY_IVL_DAYS`, `STARTING_EASE`, `MIN_EASE`, `HARD_MULTIPLIER`, `EASY_BONUS`, `FUZZ_RATIO` constants; `nextState(state: CardState, grade: Grade, now?: number, rng?: () => number): CardState`. Task 8 extends this file for the review queue; Task 9 (`queue.ts`) and `src/lib/db/cardState.ts` (Task 17) both call `nextState`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/scheduler/schedule.test.ts
import { describe, it, expect } from 'vitest';
import { nextState } from './schedule';
import type { CardState } from '../types';

const NOW = 1_700_000_000_000;

function newCard(): CardState {
  return { cid: 1, queue: 'new', due: 0, ivl: 0, ease: 2.5, lapses: 0, learningStep: 0 };
}

describe('nextState — new/learning queue', () => {
  it('Again on a new card enters learning at step 0, due in 1 minute', () => {
    const result = nextState(newCard(), 'again', NOW);
    expect(result.queue).toBe('learning');
    expect(result.learningStep).toBe(0);
    expect(result.due).toBe(NOW + 60_000);
  });

  it('Good on a new card advances to learning step 1, due in 10 minutes', () => {
    const result = nextState(newCard(), 'good', NOW);
    expect(result.queue).toBe('learning');
    expect(result.learningStep).toBe(1);
    expect(result.due).toBe(NOW + 10 * 60_000);
  });

  it('Good on the last learning step graduates to review with a 1-day interval', () => {
    const atLastStep: CardState = { ...newCard(), queue: 'learning', learningStep: 1 };
    const result = nextState(atLastStep, 'good', NOW);
    expect(result.queue).toBe('review');
    expect(result.ivl).toBe(1);
    expect(result.ease).toBe(2.5);
    expect(result.due).toBe(NOW + 24 * 60 * 60_000);
  });

  it('Hard repeats the current learning step', () => {
    const atStep0: CardState = { ...newCard(), queue: 'learning', learningStep: 0 };
    const result = nextState(atStep0, 'hard', NOW);
    expect(result.queue).toBe('learning');
    expect(result.learningStep).toBe(0);
    expect(result.due).toBe(NOW + 60_000);
  });

  it('Easy graduates immediately to review with a 4-day interval', () => {
    const result = nextState(newCard(), 'easy', NOW);
    expect(result.queue).toBe('review');
    expect(result.ivl).toBe(4);
    expect(result.ease).toBe(2.5);
    expect(result.due).toBe(NOW + 4 * 24 * 60 * 60_000);
  });

  it('Again on an in-progress learning card resets to step 0', () => {
    const atStep1: CardState = { ...newCard(), queue: 'learning', learningStep: 1 };
    const result = nextState(atStep1, 'again', NOW);
    expect(result.learningStep).toBe(0);
    expect(result.due).toBe(NOW + 60_000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `src/lib/scheduler/schedule.ts` does not exist yet.

- [ ] **Step 3: Implement the learning-queue branch of `nextState`**

```ts
// src/lib/scheduler/schedule.ts
import type { CardState, Grade } from '../types';

export const LEARNING_STEPS_MIN = [1, 10];
export const RELEARNING_STEPS_MIN = [10];
export const GRADUATING_IVL_DAYS = 1;
export const EASY_IVL_DAYS = 4;
export const STARTING_EASE = 2.5;
export const MIN_EASE = 1.3;
export const HARD_MULTIPLIER = 1.2;
export const EASY_BONUS = 1.3;
export const FUZZ_RATIO = 0.05;

function minutesToMs(min: number): number {
  return min * 60_000;
}

function daysToMs(days: number): number {
  return days * 24 * 60 * 60_000;
}

function applyLearningStep(
  state: CardState,
  grade: Grade,
  now: number,
  steps: number[],
  graduateIvlDays: number
): CardState {
  if (grade === 'easy') {
    return {
      ...state,
      queue: 'review',
      ivl: EASY_IVL_DAYS,
      ease: state.ease || STARTING_EASE,
      due: now + daysToMs(EASY_IVL_DAYS),
      learningStep: 0,
    };
  }
  if (grade === 'again') {
    return { ...state, queue: state.queue === 'relearning' ? 'relearning' : 'learning', learningStep: 0, due: now + minutesToMs(steps[0]) };
  }
  const currentStep = state.queue === 'new' ? 0 : state.learningStep;
  if (grade === 'hard') {
    return {
      ...state,
      queue: state.queue === 'new' ? 'learning' : state.queue,
      learningStep: currentStep,
      due: now + minutesToMs(steps[currentStep]),
    };
  }
  // good
  const nextStep = currentStep + 1;
  if (nextStep >= steps.length) {
    return {
      ...state,
      queue: 'review',
      ivl: graduateIvlDays,
      ease: state.ease || STARTING_EASE,
      due: now + daysToMs(graduateIvlDays),
      learningStep: 0,
    };
  }
  return {
    ...state,
    queue: state.queue === 'new' ? 'learning' : state.queue,
    learningStep: nextStep,
    due: now + minutesToMs(steps[nextStep]),
  };
}

export function nextState(
  state: CardState,
  grade: Grade,
  now: number = Date.now(),
  rng: () => number = Math.random
): CardState {
  if (state.queue === 'new' || state.queue === 'learning') {
    return applyLearningStep(state, grade, now, LEARNING_STEPS_MIN, GRADUATING_IVL_DAYS);
  }
  if (state.queue === 'relearning') {
    return applyLearningStep(state, grade, now, RELEARNING_STEPS_MIN, Math.max(1, state.ivl));
  }
  return applyReviewGrade(state, grade, now, rng);
}

// Implemented in Task 8.
function applyReviewGrade(state: CardState, _grade: Grade, _now: number, _rng: () => number): CardState {
  return state;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/schedule.ts src/lib/scheduler/schedule.test.ts
git commit -m "Add scheduler: learning-queue transitions"
```

---

## Task 8: Scheduler — review-queue transitions and lapses

**Files:**
- Modify: `src/lib/scheduler/schedule.ts`
- Modify: `src/lib/scheduler/schedule.test.ts`

**Interfaces:**
- Consumes: everything from Task 7 (extends the same `applyReviewGrade` stub).
- Produces: the completed `applyReviewGrade` behavior, reachable through the same `nextState` signature. No new exports.

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/scheduler/schedule.test.ts`:

```ts
function reviewCard(overrides: Partial<CardState> = {}): CardState {
  return { cid: 1, queue: 'review', due: 0, ivl: 10, ease: 2.5, lapses: 0, learningStep: 0, ...overrides };
}

const noFuzz = () => 0.5; // rng()*2-1 === 0, i.e. no fuzz applied

describe('nextState — review queue', () => {
  it('Good multiplies the interval by ease', () => {
    const result = nextState(reviewCard({ ivl: 10, ease: 2.5 }), 'good', NOW, noFuzz);
    expect(result.queue).toBe('review');
    expect(result.ivl).toBe(25);
    expect(result.ease).toBe(2.5);
    expect(result.due).toBe(NOW + 25 * 24 * 60 * 60_000);
  });

  it('Hard multiplies the interval by 1.2 and lowers ease by 0.15', () => {
    const result = nextState(reviewCard({ ivl: 10, ease: 2.5 }), 'hard', NOW, noFuzz);
    expect(result.ivl).toBe(12);
    expect(result.ease).toBeCloseTo(2.35);
  });

  it('Easy multiplies the interval by ease * 1.3 and raises ease by 0.15', () => {
    const result = nextState(reviewCard({ ivl: 10, ease: 2.5 }), 'easy', NOW, noFuzz);
    expect(result.ivl).toBe(33); // round(10 * 2.5 * 1.3)
    expect(result.ease).toBeCloseTo(2.65);
  });

  it('Again drops the card into relearning, increments lapses, and lowers ease', () => {
    const result = nextState(reviewCard({ ivl: 10, ease: 2.5, lapses: 2 }), 'again', NOW, noFuzz);
    expect(result.queue).toBe('relearning');
    expect(result.lapses).toBe(3);
    expect(result.ease).toBeCloseTo(2.3);
    expect(result.due).toBe(NOW + 10 * 60_000);
  });

  it('ease never drops below the 1.3 floor', () => {
    const result = nextState(reviewCard({ ease: 1.35 }), 'again', NOW, noFuzz);
    expect(result.ease).toBe(1.3);
  });

  it('a relearning card graduates back to review using the ivl captured at lapse time', () => {
    const relearning: CardState = { cid: 1, queue: 'relearning', due: 0, ivl: 6, ease: 2.3, lapses: 1, learningStep: 0 };
    const result = nextState(relearning, 'good', NOW, noFuzz);
    expect(result.queue).toBe('review');
    expect(result.ivl).toBe(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — the stub `applyReviewGrade` returns the input state unchanged.

- [ ] **Step 3: Implement `applyReviewGrade`**

Replace the stub at the bottom of `src/lib/scheduler/schedule.ts`:

```ts
function applyFuzz(ivlDays: number, rng: () => number): number {
  const fuzz = ivlDays * FUZZ_RATIO * (rng() * 2 - 1);
  return Math.max(1, Math.round(ivlDays + fuzz));
}

function applyReviewGrade(state: CardState, grade: Grade, now: number, rng: () => number): CardState {
  if (grade === 'again') {
    const newEase = Math.max(MIN_EASE, state.ease - 0.2);
    return {
      ...state,
      queue: 'relearning',
      ease: newEase,
      lapses: state.lapses + 1,
      ivl: 0,
      learningStep: 0,
      due: now + minutesToMs(RELEARNING_STEPS_MIN[0]),
    };
  }
  if (grade === 'hard') {
    const ivl = applyFuzz(state.ivl * HARD_MULTIPLIER, rng);
    return { ...state, queue: 'review', ease: Math.max(MIN_EASE, state.ease - 0.15), ivl, due: now + daysToMs(ivl) };
  }
  if (grade === 'good') {
    const ivl = applyFuzz(state.ivl * state.ease, rng);
    return { ...state, queue: 'review', ivl, due: now + daysToMs(ivl) };
  }
  // easy
  const ivl = applyFuzz(state.ivl * state.ease * EASY_BONUS, rng);
  return { ...state, queue: 'review', ease: state.ease + 0.15, ivl, due: now + daysToMs(ivl) };
}
```

Remove the old stub function (the new one replaces it in place) and delete the now-unused `_grade`/`_now`/`_rng` stub signature.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (12 tests in this file)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/schedule.ts src/lib/scheduler/schedule.test.ts
git commit -m "Add scheduler: review-queue transitions and lapses"
```

---

## Task 9: Scheduler — session queue ordering

**Files:**
- Create: `src/lib/scheduler/queue.ts`
- Test: `src/lib/scheduler/queue.test.ts`

**Interfaces:**
- Consumes: `Queue` from `src/lib/types.ts` (Task 2).
- Produces: `QueueCard` type, `buildSessionQueue(cards: QueueCard[], now?: number): QueueCard[]`. Consumed by `src/lib/db/decks.ts`'s `getSessionQueueForDeck` (Task 18).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/scheduler/queue.test.ts
import { describe, it, expect } from 'vitest';
import { buildSessionQueue, type QueueCard } from './queue';

const NOW = 1_700_000_000_000;

describe('buildSessionQueue', () => {
  it('orders due learning/relearning cards before due review cards before new cards', () => {
    const cards: QueueCard[] = [
      { cid: 3, queue: 'new', due: 0 },
      { cid: 2, queue: 'review', due: NOW - 1000 },
      { cid: 1, queue: 'learning', due: NOW - 2000 },
    ];
    expect(buildSessionQueue(cards, NOW).map((c) => c.cid)).toEqual([1, 2, 3]);
  });

  it('sorts within the learning/relearning group by soonest due first', () => {
    const cards: QueueCard[] = [
      { cid: 1, queue: 'learning', due: NOW - 1000 },
      { cid: 2, queue: 'relearning', due: NOW - 5000 },
    ];
    expect(buildSessionQueue(cards, NOW).map((c) => c.cid)).toEqual([2, 1]);
  });

  it('sorts new cards by ascending cid (creation order)', () => {
    const cards: QueueCard[] = [
      { cid: 5, queue: 'new', due: 0 },
      { cid: 2, queue: 'new', due: 0 },
    ];
    expect(buildSessionQueue(cards, NOW).map((c) => c.cid)).toEqual([2, 5]);
  });

  it('excludes learning/review cards that are not yet due', () => {
    const cards: QueueCard[] = [
      { cid: 1, queue: 'learning', due: NOW + 100_000 },
      { cid: 2, queue: 'review', due: NOW + 100_000 },
    ];
    expect(buildSessionQueue(cards, NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `src/lib/scheduler/queue.ts` does not exist yet.

- [ ] **Step 3: Implement `buildSessionQueue`**

```ts
// src/lib/scheduler/queue.ts
import type { Queue } from '../types';

export interface QueueCard {
  cid: number;
  queue: Queue;
  due: number;
}

export function buildSessionQueue(cards: QueueCard[], now: number = Date.now()): QueueCard[] {
  const dueLearning = cards
    .filter((c) => (c.queue === 'learning' || c.queue === 'relearning') && c.due <= now)
    .sort((a, b) => a.due - b.due);
  const dueReview = cards
    .filter((c) => c.queue === 'review' && c.due <= now)
    .sort((a, b) => a.due - b.due);
  const newCards = cards.filter((c) => c.queue === 'new').sort((a, b) => a.cid - b.cid);
  return [...dueLearning, ...dueReview, ...newCards];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/queue.ts src/lib/scheduler/queue.test.ts
git commit -m "Add scheduler: session queue ordering"
```

---

## Task 10: apkg — zip extraction

**Files:**
- Create: `src/lib/apkg/zip.ts`
- Create: `src/lib/apkg/testFixtures.ts`
- Test: `src/lib/apkg/zip.test.ts`

**Interfaces:**
- Consumes: `fflate`'s `zipSync`/`unzipSync` (test fixture only uses `zipSync`; production code only uses `unzipSync`).
- Produces: `ExtractedApkg` type, `extractApkgZip(zipBytes: Uint8Array): ExtractedApkg`. `testFixtures.ts` produces `buildFixtureApkgBytes(collectionBytes: Uint8Array, mediaFiles?: Record<string, Uint8Array>): Uint8Array`, reused by Tasks 11-13's tests.

- [ ] **Step 1: Write the fixture helper**

```ts
// src/lib/apkg/testFixtures.ts
import { zipSync } from 'fflate';

/** Builds a minimal in-memory .apkg zip for tests. Not used in production code. */
export function buildFixtureApkgBytes(
  collectionBytes: Uint8Array,
  mediaFiles: Record<string, Uint8Array> = { '0': new Uint8Array([1, 2, 3, 4]) },
  collectionFilename: 'collection.anki2' | 'collection.anki21' = 'collection.anki2'
): Uint8Array {
  const manifestNames: Record<string, string> = {};
  Object.keys(mediaFiles).forEach((key, i) => {
    manifestNames[key] = `media-${i}.bin`;
  });
  return zipSync({
    [collectionFilename]: collectionBytes,
    media: new TextEncoder().encode(JSON.stringify(manifestNames)),
    ...mediaFiles,
  });
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/apkg/zip.test.ts
import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { extractApkgZip } from './zip';
import { buildFixtureApkgBytes } from './testFixtures';

describe('extractApkgZip', () => {
  it('extracts the collection.anki2 bytes when present', () => {
    const collection = new Uint8Array([9, 9, 9]);
    const zip = buildFixtureApkgBytes(collection);
    const result = extractApkgZip(zip);
    expect(Array.from(result.collectionBytes)).toEqual([9, 9, 9]);
  });

  it('prefers collection.anki21 over collection.anki2 when both are present', () => {
    const zip = zipSync({
      'collection.anki2': new Uint8Array([1]),
      'collection.anki21': new Uint8Array([2]),
      media: new TextEncoder().encode('{}'),
    });
    const result = extractApkgZip(zip);
    expect(Array.from(result.collectionBytes)).toEqual([2]);
  });

  it('decodes the media manifest and matching entries', () => {
    const zip = buildFixtureApkgBytes(new Uint8Array([1]), { '0': new Uint8Array([7, 7]) });
    const result = extractApkgZip(zip);
    expect(result.mediaManifest['0']).toBe('media-0.bin');
    expect(Array.from(result.mediaEntries['0'])).toEqual([7, 7]);
  });

  it('throws a clear error for zstd-compressed collections', () => {
    const zip = zipSync({ 'collection.anki21b': new Uint8Array([1]), media: new TextEncoder().encode('{}') });
    expect(() => extractApkgZip(zip)).toThrow(/newer compressed format/);
  });

  it('throws a clear error when no collection file is found at all', () => {
    const zip = zipSync({ media: new TextEncoder().encode('{}') });
    expect(() => extractApkgZip(zip)).toThrow(/No collection database/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `src/lib/apkg/zip.ts` does not exist yet.

- [ ] **Step 4: Implement `extractApkgZip`**

```ts
// src/lib/apkg/zip.ts
import { unzipSync } from 'fflate';

export interface ExtractedApkg {
  collectionBytes: Uint8Array;
  mediaManifest: Record<string, string>; // "0" -> real filename
  mediaEntries: Record<string, Uint8Array>; // "0" -> raw file bytes
}

export function extractApkgZip(zipBytes: Uint8Array): ExtractedApkg {
  const files = unzipSync(zipBytes);

  const collectionName = files['collection.anki21'] ? 'collection.anki21' : files['collection.anki2'] ? 'collection.anki2' : null;

  if (!collectionName) {
    if (files['collection.anki21b']) {
      throw new Error(
        "This deck uses a newer compressed format Ankiduck doesn't support yet — re-export from Anki with 'Support older Anki versions' checked."
      );
    }
    throw new Error('No collection database found in this .apkg file.');
  }

  const mediaManifest: Record<string, string> = files['media'] ? JSON.parse(new TextDecoder().decode(files['media'])) : {};

  const mediaEntries: Record<string, Uint8Array> = {};
  for (const key of Object.keys(mediaManifest)) {
    if (files[key]) mediaEntries[key] = files[key];
  }

  return { collectionBytes: files[collectionName], mediaManifest, mediaEntries };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/apkg/zip.ts src/lib/apkg/zip.test.ts src/lib/apkg/testFixtures.ts
git commit -m "Add apkg zip extraction"
```

---

## Task 11: apkg — legacy schema (collection.anki2) parsing

**Files:**
- Create: `src/lib/apkg/schema.ts`
- Test: `src/lib/apkg/schema.test.ts`

**Interfaces:**
- Consumes: `Deck`, `NoteType`, `NoteTypeTemplate` from `src/lib/types.ts`; `sql.js`'s `Database`/`SqlJsStatic` types.
- Produces: `hasNotetypesTable(db: Database): boolean`, `parseLegacyDecksAndModels(db: Database): { decks: Deck[]; noteTypes: NoteType[] }`, `parseModernSchemaUnsupported(): never` (Task 12 adds this). Consumed by `src/lib/apkg/parse.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/apkg/schema.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type SqlJsStatic, type Database } from 'sql.js';
import { hasNotetypesTable, parseLegacyDecksAndModels } from './schema';

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (file) => `node_modules/sql.js/dist/${file}` });
});

function buildLegacyDb(): Database {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE col (
      id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER,
      dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT
    );
  `);
  const decksJson = JSON.stringify({
    '1': { id: 1, name: 'Default' },
    '2': { id: 2, name: 'Swedish 8k::Verbs' },
  });
  const modelsJson = JSON.stringify({
    '100': {
      id: 100,
      name: 'Basic',
      type: 0,
      css: '.card { color: black; }',
      flds: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }],
    },
    '200': {
      id: 200,
      name: 'Cloze',
      type: 1,
      css: '.card { color: blue; }',
      flds: [{ name: 'Text', ord: 0 }],
      tmpls: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }],
    },
  });
  db.run('INSERT INTO col VALUES (1,0,0,0,11,0,0,0,"{}",?,?,"{}","{}")', [modelsJson, decksJson]);
  return db;
}

describe('hasNotetypesTable', () => {
  it('returns false for a legacy-schema database', () => {
    expect(hasNotetypesTable(buildLegacyDb())).toBe(false);
  });
});

describe('parseLegacyDecksAndModels', () => {
  it('parses deck names and path segments from the decks JSON blob', () => {
    const { decks } = parseLegacyDecksAndModels(buildLegacyDb());
    expect(decks).toContainEqual({ did: 1, name: 'Default', pathSegments: ['Default'] });
    expect(decks).toContainEqual({ did: 2, name: 'Swedish 8k::Verbs', pathSegments: ['Swedish 8k', 'Verbs'] });
  });

  it('parses note type fields and templates in ord order', () => {
    const { noteTypes } = parseLegacyDecksAndModels(buildLegacyDb());
    const basic = noteTypes.find((nt) => nt.mid === 100)!;
    expect(basic.fields).toEqual(['Front', 'Back']);
    expect(basic.templates).toEqual([{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }]);
    expect(basic.css).toBe('.card { color: black; }');
    expect(basic.isCloze).toBe(false);
  });

  it('marks type:1 note types as cloze', () => {
    const { noteTypes } = parseLegacyDecksAndModels(buildLegacyDb());
    const cloze = noteTypes.find((nt) => nt.mid === 200)!;
    expect(cloze.isCloze).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `src/lib/apkg/schema.ts` does not exist yet.

- [ ] **Step 3: Implement `hasNotetypesTable` and `parseLegacyDecksAndModels`**

```ts
// src/lib/apkg/schema.ts
import type { Database } from 'sql.js';
import type { Deck, NoteType, NoteTypeTemplate } from '../types';

interface LegacyDeckJson {
  id: number;
  name: string;
}

interface LegacyFieldJson {
  name: string;
  ord: number;
}

interface LegacyTemplateJson {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
}

interface LegacyModelJson {
  id: number;
  name: string;
  type: number;
  css: string;
  flds: LegacyFieldJson[];
  tmpls: LegacyTemplateJson[];
}

export function hasNotetypesTable(db: Database): boolean {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'");
  return res.length > 0 && res[0].values.length > 0;
}

export function parseLegacyDecksAndModels(db: Database): { decks: Deck[]; noteTypes: NoteType[] } {
  const res = db.exec('SELECT decks, models FROM col');
  const row = res[0].values[0];
  const decksJson: Record<string, LegacyDeckJson> = JSON.parse(row[0] as string);
  const modelsJson: Record<string, LegacyModelJson> = JSON.parse(row[1] as string);

  const decks: Deck[] = Object.values(decksJson).map((d) => ({
    did: Number(d.id),
    name: d.name,
    pathSegments: d.name.split('::'),
  }));

  const noteTypes: NoteType[] = Object.values(modelsJson).map((m) => {
    const fields = [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name);
    const templates: NoteTypeTemplate[] = [...m.tmpls]
      .sort((a, b) => a.ord - b.ord)
      .map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt }));
    return {
      mid: Number(m.id),
      name: m.name,
      fields,
      templates,
      css: m.css,
      isCloze: Number(m.type) === 1,
    };
  });

  return { decks, noteTypes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/apkg/schema.ts src/lib/apkg/schema.test.ts
git commit -m "Add apkg legacy schema (collection.anki2) parsing"
```

---

## Task 12: apkg — modern schema explicit rejection

**Files:**
- Modify: `src/lib/apkg/schema.ts`
- Modify: `src/lib/apkg/schema.test.ts`

**Interfaces:**
- Consumes: `hasNotetypesTable` (Task 11).
- Produces: `parseModernSchemaUnsupported(): never` — throws. Called by `src/lib/apkg/parse.ts` (Task 13) whenever `hasNotetypesTable` returns `true`.

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/apkg/schema.test.ts`:

```ts
import { parseModernSchemaUnsupported } from './schema';

function buildModernDb(): Database {
  const db = new SQL.Database();
  db.run('CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT, config BLOB)');
  return db;
}

describe('hasNotetypesTable (modern schema)', () => {
  it('returns true when a notetypes table is present', () => {
    expect(hasNotetypesTable(buildModernDb())).toBe(true);
  });
});

describe('parseModernSchemaUnsupported', () => {
  it('throws a clear unsupported-format error', () => {
    expect(() => parseModernSchemaUnsupported()).toThrow(/newer note-type format/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `parseModernSchemaUnsupported` not exported.

- [ ] **Step 3: Implement `parseModernSchemaUnsupported`**

Append to `src/lib/apkg/schema.ts`:

```ts
export function parseModernSchemaUnsupported(): never {
  throw new Error(
    "This deck uses a newer note-type format Ankiduck doesn't support yet — re-export from Anki with 'Support older Anki versions' checked."
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (6 tests in this file)

- [ ] **Step 5: Commit**

```bash
git add src/lib/apkg/schema.ts src/lib/apkg/schema.test.ts
git commit -m "Add apkg modern-schema explicit unsupported-format error"
```

---

## Task 13: apkg — full parse orchestration

**Files:**
- Create: `src/lib/apkg/parse.ts`
- Test: `src/lib/apkg/parse.test.ts`

**Interfaces:**
- Consumes: `ExtractedApkg` (Task 10); `hasNotetypesTable`, `parseLegacyDecksAndModels`, `parseModernSchemaUnsupported` (Tasks 11-12); `ParsedApkg`, `Note`, `Card`, `MediaFile` (Task 2); `sql.js`'s `SqlJsStatic`.
- Produces: `parseApkg(extracted: ExtractedApkg, SQL: SqlJsStatic): ParsedApkg`. Consumed by `src/workers/import.worker.ts` (Task 19).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/apkg/parse.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { parseApkg } from './parse';
import { extractApkgZip } from './zip';
import { buildFixtureApkgBytes } from './testFixtures';

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (file) => `node_modules/sql.js/dist/${file}` });
});

function buildLegacyCollectionBytes(): Uint8Array {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE col (
      id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER,
      dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER,
      tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT
    );
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER,
      type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER,
      lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT
    );
  `);
  const decksJson = JSON.stringify({ '2': { id: 2, name: 'Swedish 8k' } });
  const modelsJson = JSON.stringify({
    '100': {
      id: 100,
      name: 'Basic',
      type: 0,
      css: '.card {}',
      flds: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }],
    },
  });
  db.run('INSERT INTO col VALUES (1,0,0,0,11,0,0,0,"{}",?,?,"{}","{}")', [modelsJson, decksJson]);
  db.run('INSERT INTO notes VALUES (1000,"g1",100,0,0,"","hejhello","hej",0,0,"")');
  db.run('INSERT INTO cards VALUES (2000,1000,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,"")');
  const bytes = db.export();
  db.close();
  return bytes;
}

describe('parseApkg', () => {
  it('parses decks, note types, notes, cards, and media from a legacy-schema apkg', async () => {
    const zipBytes = buildFixtureApkgBytes(buildLegacyCollectionBytes(), { '0': new Uint8Array([1, 2, 3]) });
    const extracted = extractApkgZip(zipBytes);
    const parsed = await parseApkg(extracted, SQL);

    expect(parsed.decks).toEqual([{ did: 2, name: 'Swedish 8k', pathSegments: ['Swedish 8k'] }]);
    expect(parsed.noteTypes[0].mid).toBe(100);
    expect(parsed.notes).toEqual([{ nid: 1000, mid: 100, guid: 'g1', fields: ['hej', 'hello'] }]);
    expect(parsed.cards).toEqual([{ cid: 2000, nid: 1000, did: 2, ord: 0 }]);
    expect(parsed.media).toHaveLength(1);
    expect(parsed.media[0].filename).toBe('media-0.bin');
    expect(await parsed.media[0].blob.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it('throws the unsupported-format error for a modern-schema apkg', async () => {
    const db = new SQL.Database();
    db.run('CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT, config BLOB)');
    const collectionBytes = db.export();
    db.close();
    const zipBytes = buildFixtureApkgBytes(collectionBytes, {});
    const extracted = extractApkgZip(zipBytes);
    await expect(parseApkg(extracted, SQL)).rejects.toThrow(/newer note-type format/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `src/lib/apkg/parse.ts` does not exist yet.

- [ ] **Step 3: Implement `parseApkg`**

```ts
// src/lib/apkg/parse.ts
import type { SqlJsStatic } from 'sql.js';
import type { ExtractedApkg } from './zip';
import type { ParsedApkg, Note, Card } from '../types';
import { hasNotetypesTable, parseLegacyDecksAndModels, parseModernSchemaUnsupported } from './schema';

export async function parseApkg(extracted: ExtractedApkg, SQL: SqlJsStatic): Promise<ParsedApkg> {
  const db = new SQL.Database(extracted.collectionBytes);
  try {
    if (hasNotetypesTable(db)) {
      parseModernSchemaUnsupported();
    }
    const { decks, noteTypes } = parseLegacyDecksAndModels(db);

    const noteRows = db.exec('SELECT id, mid, guid, flds FROM notes');
    const notes: Note[] = noteRows.length
      ? noteRows[0].values.map((row) => ({
          nid: Number(row[0]),
          mid: Number(row[1]),
          guid: row[2] as string,
          fields: (row[3] as string).split(''),
        }))
      : [];

    const cardRows = db.exec('SELECT id, nid, did, ord FROM cards');
    const cards: Card[] = cardRows.length
      ? cardRows[0].values.map((row) => ({
          cid: Number(row[0]),
          nid: Number(row[1]),
          did: Number(row[2]),
          ord: Number(row[3]),
        }))
      : [];

    const media = Object.entries(extracted.mediaManifest)
      .filter(([key]) => extracted.mediaEntries[key])
      .map(([key, filename]) => ({
        filename,
        blob: new Blob([extracted.mediaEntries[key]]),
      }));

    return { decks, noteTypes, notes, cards, media };
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/apkg/parse.ts src/lib/apkg/parse.test.ts
git commit -m "Add apkg parse orchestration"
```

---

## Task 14: IndexedDB schema

**Files:**
- Create: `src/lib/db/schema.ts`
- Test: `src/lib/db/schema.test.ts`

**Interfaces:**
- Consumes: `Deck`, `NoteType`, `Note`, `Card`, `CardState`, `MediaFile` from `src/lib/types.ts`; `idb`'s `openDB`, `DBSchema`, `IDBPDatabase`.
- Produces: `AnkiduckDB` schema type, `openAnkiduckDb(name?: string): Promise<IDBPDatabase<AnkiduckDB>>`. Every other `src/lib/db/*` task (15-18) imports `AnkiduckDB` and calls `openAnkiduckDb`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/db/schema.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openAnkiduckDb } from './schema';

describe('openAnkiduckDb', () => {
  it('creates all six object stores with the expected key paths', async () => {
    const db = await openAnkiduckDb('test-schema-1');
    expect(db.objectStoreNames.contains('decks')).toBe(true);
    expect(db.objectStoreNames.contains('noteTypes')).toBe(true);
    expect(db.objectStoreNames.contains('notes')).toBe(true);
    expect(db.objectStoreNames.contains('cards')).toBe(true);
    expect(db.objectStoreNames.contains('cardState')).toBe(true);
    expect(db.objectStoreNames.contains('media')).toBe(true);
    db.close();
  });

  it('supports put/get by the declared key path on each store', async () => {
    const db = await openAnkiduckDb('test-schema-2');
    await db.put('decks', { did: 1, name: 'Default', pathSegments: ['Default'] });
    expect((await db.get('decks', 1))?.name).toBe('Default');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `src/lib/db/schema.ts` does not exist yet.

- [ ] **Step 3: Implement `openAnkiduckDb`**

```ts
// src/lib/db/schema.ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Deck, NoteType, Note, Card, CardState, MediaFile } from '../types';

export interface AnkiduckDB extends DBSchema {
  decks: { key: number; value: Deck };
  noteTypes: { key: number; value: NoteType };
  notes: { key: number; value: Note };
  cards: { key: number; value: Card; indexes: { by_did: number } };
  cardState: { key: number; value: CardState; indexes: { by_queue: string } };
  media: { key: string; value: MediaFile };
}

export async function openAnkiduckDb(name = 'ankiduck'): Promise<IDBPDatabase<AnkiduckDB>> {
  return openDB<AnkiduckDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('decks', { keyPath: 'did' });
      db.createObjectStore('noteTypes', { keyPath: 'mid' });
      db.createObjectStore('notes', { keyPath: 'nid' });
      const cardStore = db.createObjectStore('cards', { keyPath: 'cid' });
      cardStore.createIndex('by_did', 'did');
      const stateStore = db.createObjectStore('cardState', { keyPath: 'cid' });
      stateStore.createIndex('by_queue', 'queue');
      db.createObjectStore('media', { keyPath: 'filename' });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/schema.test.ts
git commit -m "Add IndexedDB schema"
```

---

## Task 15: IndexedDB — content merge and cardState upsert

**Files:**
- Create: `src/lib/db/content.ts`
- Test: `src/lib/db/content.test.ts`

**Interfaces:**
- Consumes: `AnkiduckDB`, `openAnkiduckDb` (Task 14); `ParsedApkg`, `CardState` (Task 2).
- Produces: `mergeImport(db: IDBPDatabase<AnkiduckDB>, parsed: ParsedApkg, resetScheduling: boolean): Promise<void>`. Called by `src/lib/import/controller.ts` (Task 19) and driven from the import UI's reset-scheduling toggle (Task 21).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/db/content.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openAnkiduckDb } from './schema';
import { mergeImport } from './content';
import type { ParsedApkg } from '../types';

function parsedFixture(overrides: Partial<ParsedApkg> = {}): ParsedApkg {
  return {
    decks: [{ did: 1, name: 'Default', pathSegments: ['Default'] }],
    noteTypes: [{ mid: 100, name: 'Basic', fields: ['Front', 'Back'], templates: [], css: '', isCloze: false }],
    notes: [{ nid: 1000, mid: 100, guid: 'g1', fields: ['a', 'b'] }],
    cards: [{ cid: 2000, nid: 1000, did: 1, ord: 0 }],
    media: [],
    ...overrides,
  };
}

describe('mergeImport', () => {
  it('creates decks/noteTypes/notes/cards and a fresh new-state cardState row', async () => {
    const db = await openAnkiduckDb('test-content-1');
    await mergeImport(db, parsedFixture(), false);

    expect(await db.get('decks', 1)).toBeDefined();
    expect(await db.get('notes', 1000)).toBeDefined();
    expect(await db.get('cards', 2000)).toBeDefined();
    const state = await db.get('cardState', 2000);
    expect(state?.queue).toBe('new');
    db.close();
  });

  it('does not clobber existing cardState progress on re-import when resetScheduling is false', async () => {
    const db = await openAnkiduckDb('test-content-2');
    await mergeImport(db, parsedFixture(), false);
    await db.put('cardState', { cid: 2000, queue: 'review', due: 123, ivl: 30, ease: 2.6, lapses: 1, learningStep: 0 });

    await mergeImport(db, parsedFixture(), false);

    const state = await db.get('cardState', 2000);
    expect(state?.queue).toBe('review');
    expect(state?.ivl).toBe(30);
    db.close();
  });

  it('resets cardState to new when resetScheduling is true', async () => {
    const db = await openAnkiduckDb('test-content-3');
    await mergeImport(db, parsedFixture(), false);
    await db.put('cardState', { cid: 2000, queue: 'review', due: 123, ivl: 30, ease: 2.6, lapses: 1, learningStep: 0 });

    await mergeImport(db, parsedFixture(), true);

    const state = await db.get('cardState', 2000);
    expect(state?.queue).toBe('new');
    db.close();
  });

  it('upserts deck/note/card content by Anki ID rather than duplicating', async () => {
    const db = await openAnkiduckDb('test-content-4');
    await mergeImport(db, parsedFixture(), false);
    await mergeImport(db, parsedFixture({ decks: [{ did: 1, name: 'Renamed', pathSegments: ['Renamed'] }] }), false);

    const allDecks = await db.getAll('decks');
    expect(allDecks).toHaveLength(1);
    expect(allDecks[0].name).toBe('Renamed');
    db.close();
  });

  it('stores media files', async () => {
    const db = await openAnkiduckDb('test-content-5');
    await mergeImport(db, parsedFixture({ media: [{ filename: 'a.mp3', blob: new Blob(['x']) }] }), false);
    expect(await db.get('media', 'a.mp3')).toBeDefined();
    db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `src/lib/db/content.ts` does not exist yet.

- [ ] **Step 3: Implement `mergeImport`**

```ts
// src/lib/db/content.ts
import type { IDBPDatabase } from 'idb';
import type { AnkiduckDB } from './schema';
import type { ParsedApkg, CardState } from '../types';

export async function mergeImport(db: IDBPDatabase<AnkiduckDB>, parsed: ParsedApkg, resetScheduling: boolean): Promise<void> {
  const tx = db.transaction(['decks', 'noteTypes', 'notes', 'cards', 'cardState', 'media'], 'readwrite');

  for (const deck of parsed.decks) await tx.objectStore('decks').put(deck);
  for (const noteType of parsed.noteTypes) await tx.objectStore('noteTypes').put(noteType);
  for (const note of parsed.notes) await tx.objectStore('notes').put(note);

  for (const card of parsed.cards) {
    await tx.objectStore('cards').put(card);
    const existing = await tx.objectStore('cardState').get(card.cid);
    if (!existing || resetScheduling) {
      const fresh: CardState = { cid: card.cid, queue: 'new', due: 0, ivl: 0, ease: 2.5, lapses: 0, learningStep: 0 };
      await tx.objectStore('cardState').put(fresh);
    }
  }

  for (const media of parsed.media) await tx.objectStore('media').put(media);

  await tx.done;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/content.ts src/lib/db/content.test.ts
git commit -m "Add IndexedDB content merge with cardState upsert semantics"
```

---

## Task 16: IndexedDB — grading a card

**Files:**
- Create: `src/lib/db/cardState.ts`
- Test: `src/lib/db/cardState.test.ts`

**Interfaces:**
- Consumes: `AnkiduckDB`, `openAnkiduckDb` (Task 14); `nextState` from `src/lib/scheduler/schedule.ts` (Tasks 7-8); `Grade`, `CardState` (Task 2).
- Produces: `gradeCard(db: IDBPDatabase<AnkiduckDB>, cid: number, grade: Grade, now?: number): Promise<CardState>`. Called by `Review.svelte` (Task 23) when the user taps a grade button.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/db/cardState.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openAnkiduckDb } from './schema';
import { gradeCard } from './cardState';

describe('gradeCard', () => {
  it('applies the scheduler transition and persists the new state', async () => {
    const db = await openAnkiduckDb('test-cardstate-1');
    await db.put('cardState', { cid: 1, queue: 'new', due: 0, ivl: 0, ease: 2.5, lapses: 0, learningStep: 0 });

    const result = await gradeCard(db, 1, 'good', 1_700_000_000_000);

    expect(result.queue).toBe('learning');
    const stored = await db.get('cardState', 1);
    expect(stored?.queue).toBe('learning');
    db.close();
  });

  it('throws when no cardState exists for the given cid', async () => {
    const db = await openAnkiduckDb('test-cardstate-2');
    await expect(gradeCard(db, 999, 'good')).rejects.toThrow(/999/);
    db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `src/lib/db/cardState.ts` does not exist yet.

- [ ] **Step 3: Implement `gradeCard`**

```ts
// src/lib/db/cardState.ts
import type { IDBPDatabase } from 'idb';
import type { AnkiduckDB } from './schema';
import type { CardState, Grade } from '../types';
import { nextState } from '../scheduler/schedule';

export async function gradeCard(
  db: IDBPDatabase<AnkiduckDB>,
  cid: number,
  grade: Grade,
  now: number = Date.now()
): Promise<CardState> {
  const current = await db.get('cardState', cid);
  if (!current) {
    throw new Error(`No cardState found for cid ${cid}`);
  }
  const updated = nextState(current, grade, now);
  await db.put('cardState', updated);
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/cardState.ts src/lib/db/cardState.test.ts
git commit -m "Add IndexedDB gradeCard"
```

---

## Task 17: IndexedDB — deck tree, due counts, and session queue

**Files:**
- Create: `src/lib/db/decks.ts`
- Test: `src/lib/db/decks.test.ts`

**Interfaces:**
- Consumes: `AnkiduckDB`, `openAnkiduckDb` (Task 14); `buildSessionQueue` from `src/lib/scheduler/queue.ts` (Task 9); `Deck`, `CardState` (Task 2).
- Produces: `DeckTreeNode` type, `buildDeckTree(db, now?): Promise<DeckTreeNode[]>`, `collectDeckIds(node: DeckTreeNode): number[]`, `getSessionQueueForDeck(db, deckIds: number[], now?): Promise<QueueCard[]>`. Consumed by `DeckList.svelte` (Task 22) and `Review.svelte` (Task 23).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/db/decks.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openAnkiduckDb } from './schema';
import { buildDeckTree, collectDeckIds, getSessionQueueForDeck } from './decks';
import type { IDBPDatabase } from 'idb';
import type { AnkiduckDB } from './schema';

async function seed(db: IDBPDatabase<AnkiduckDB>, now: number) {
  await db.put('decks', { did: 1, name: 'Swedish 8k', pathSegments: ['Swedish 8k'] });
  await db.put('decks', { did: 2, name: 'Swedish 8k::Verbs', pathSegments: ['Swedish 8k', 'Verbs'] });
  await db.put('cards', { cid: 10, nid: 100, did: 1, ord: 0 });
  await db.put('cards', { cid: 20, nid: 200, did: 2, ord: 0 });
  await db.put('cardState', { cid: 10, queue: 'new', due: 0, ivl: 0, ease: 2.5, lapses: 0, learningStep: 0 });
  await db.put('cardState', { cid: 20, queue: 'review', due: now - 1000, ivl: 5, ease: 2.5, lapses: 0, learningStep: 0 });
}

describe('buildDeckTree', () => {
  it('nests decks by :: path and rolls up due/new counts to the parent', async () => {
    const db = await openAnkiduckDb('test-decks-1');
    const now = 1_700_000_000_000;
    await seed(db, now);

    const tree = await buildDeckTree(db, now);

    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.segment).toBe('Swedish 8k');
    expect(root.did).toBe(1);
    expect(root.newCount).toBe(1); // rolled up from itself
    expect(root.dueCount).toBe(1); // rolled up from the Verbs child
    expect(root.children).toHaveLength(1);
    expect(root.children[0].segment).toBe('Verbs');
    expect(root.children[0].dueCount).toBe(1);
    db.close();
  });
});

describe('collectDeckIds', () => {
  it('collects a node\'s own did plus all descendant dids', async () => {
    const db = await openAnkiduckDb('test-decks-2');
    const now = 1_700_000_000_000;
    await seed(db, now);
    const tree = await buildDeckTree(db, now);
    expect(collectDeckIds(tree[0]).sort()).toEqual([1, 2]);
    db.close();
  });
});

describe('getSessionQueueForDeck', () => {
  it('returns due/new cards across the given deck ids, correctly ordered', async () => {
    const db = await openAnkiduckDb('test-decks-3');
    const now = 1_700_000_000_000;
    await seed(db, now);

    const queue = await getSessionQueueForDeck(db, [1, 2], now);

    expect(queue.map((c) => c.cid)).toEqual([20, 10]); // due review before new
    db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `src/lib/db/decks.ts` does not exist yet.

- [ ] **Step 3: Implement `buildDeckTree`, `collectDeckIds`, `getSessionQueueForDeck`**

```ts
// src/lib/db/decks.ts
import type { IDBPDatabase } from 'idb';
import type { AnkiduckDB } from './schema';
import { buildSessionQueue, type QueueCard } from '../scheduler/queue';

export interface DeckTreeNode {
  did: number | null; // null for a synthetic path segment with no deck of its own
  segment: string;
  fullPath: string;
  children: DeckTreeNode[];
  newCount: number;
  learningCount: number;
  dueCount: number;
}

export async function buildDeckTree(db: IDBPDatabase<AnkiduckDB>, now: number = Date.now()): Promise<DeckTreeNode[]> {
  const [decks, cards, states] = await Promise.all([db.getAll('decks'), db.getAll('cards'), db.getAll('cardState')]);
  const stateByCid = new Map(states.map((s) => [s.cid, s]));

  const countsByDid = new Map<number, { newCount: number; learningCount: number; dueCount: number }>();
  for (const card of cards) {
    const state = stateByCid.get(card.cid);
    if (!state) continue;
    const bucket = countsByDid.get(card.did) ?? { newCount: 0, learningCount: 0, dueCount: 0 };
    if (state.queue === 'new') bucket.newCount++;
    else if ((state.queue === 'learning' || state.queue === 'relearning') && state.due <= now) bucket.learningCount++;
    else if (state.queue === 'review' && state.due <= now) bucket.dueCount++;
    countsByDid.set(card.did, bucket);
  }

  const roots: DeckTreeNode[] = [];
  const nodesByPath = new Map<string, DeckTreeNode>();

  const sorted = [...decks].sort((a, b) => a.pathSegments.length - b.pathSegments.length);
  for (const deck of sorted) {
    let siblings = roots;
    let pathSoFar: string[] = [];
    for (let i = 0; i < deck.pathSegments.length; i++) {
      const segment = deck.pathSegments[i];
      pathSoFar = [...pathSoFar, segment];
      const fullPath = pathSoFar.join('::');
      let node = nodesByPath.get(fullPath);
      if (!node) {
        node = { did: null, segment, fullPath, children: [], newCount: 0, learningCount: 0, dueCount: 0 };
        nodesByPath.set(fullPath, node);
        siblings.push(node);
      }
      if (i === deck.pathSegments.length - 1) {
        node.did = deck.did;
        const counts = countsByDid.get(deck.did) ?? { newCount: 0, learningCount: 0, dueCount: 0 };
        node.newCount = counts.newCount;
        node.learningCount = counts.learningCount;
        node.dueCount = counts.dueCount;
      }
      siblings = node.children;
    }
  }

  function rollUp(node: DeckTreeNode): { newCount: number; learningCount: number; dueCount: number } {
    let { newCount, learningCount, dueCount } = node;
    for (const child of node.children) {
      const childTotals = rollUp(child);
      newCount += childTotals.newCount;
      learningCount += childTotals.learningCount;
      dueCount += childTotals.dueCount;
    }
    node.newCount = newCount;
    node.learningCount = learningCount;
    node.dueCount = dueCount;
    return { newCount, learningCount, dueCount };
  }
  roots.forEach(rollUp);

  return roots;
}

export function collectDeckIds(node: DeckTreeNode): number[] {
  const ids: number[] = [];
  if (node.did !== null) ids.push(node.did);
  for (const child of node.children) ids.push(...collectDeckIds(child));
  return ids;
}

export async function getSessionQueueForDeck(
  db: IDBPDatabase<AnkiduckDB>,
  deckIds: number[],
  now: number = Date.now()
): Promise<QueueCard[]> {
  const cards = await db.getAll('cards');
  const relevant = cards.filter((c) => deckIds.includes(c.did));
  const states = await Promise.all(relevant.map((c) => db.get('cardState', c.cid)));
  const queueCards: QueueCard[] = states
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ cid: s.cid, queue: s.queue, due: s.due }));
  return buildSessionQueue(queueCards, now);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/decks.ts src/lib/db/decks.test.ts
git commit -m "Add IndexedDB deck tree, due counts, and session queue"
```

---

## Task 18: IndexedDB — deck deletion and media orphan sweep

**Files:**
- Modify: `src/lib/db/decks.ts`
- Modify: `src/lib/db/decks.test.ts`

**Interfaces:**
- Consumes: `buildDeckTree`, `collectDeckIds` (Task 17).
- Produces: `deleteDeck(db: IDBPDatabase<AnkiduckDB>, did: number): Promise<void>`, `sweepOrphanMedia(db: IDBPDatabase<AnkiduckDB>): Promise<void>`. `deleteDeck` is called by `DeckList.svelte`'s delete action (Task 22).

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/db/decks.test.ts`:

```ts
import { deleteDeck, sweepOrphanMedia } from './decks';

describe('deleteDeck', () => {
  it('removes the deck, its subdecks, their cards, cardState, and orphaned notes', async () => {
    const db = await openAnkiduckDb('test-decks-4');
    const now = 1_700_000_000_000;
    await seed(db, now);
    await db.put('notes', { nid: 100, mid: 1, guid: 'g1', fields: ['a'] });
    await db.put('notes', { nid: 200, mid: 1, guid: 'g2', fields: ['b'] });

    await deleteDeck(db, 1); // Swedish 8k, including its Verbs subdeck

    expect(await db.getAll('decks')).toHaveLength(0);
    expect(await db.getAll('cards')).toHaveLength(0);
    expect(await db.getAll('cardState')).toHaveLength(0);
    expect(await db.getAll('notes')).toHaveLength(0);
    db.close();
  });

  it('leaves other decks and their notes untouched', async () => {
    const db = await openAnkiduckDb('test-decks-5');
    const now = 1_700_000_000_000;
    await seed(db, now);
    await db.put('decks', { did: 3, name: 'Other', pathSegments: ['Other'] });
    await db.put('cards', { cid: 30, nid: 300, did: 3, ord: 0 });
    await db.put('cardState', { cid: 30, queue: 'new', due: 0, ivl: 0, ease: 2.5, lapses: 0, learningStep: 0 });
    await db.put('notes', { nid: 300, mid: 1, guid: 'g3', fields: ['c'] });

    await deleteDeck(db, 1);

    expect(await db.get('decks', 3)).toBeDefined();
    expect(await db.get('notes', 300)).toBeDefined();
    db.close();
  });
});

describe('sweepOrphanMedia', () => {
  it('removes media not referenced by any remaining note field', async () => {
    const db = await openAnkiduckDb('test-decks-6');
    await db.put('notes', { nid: 1, mid: 1, guid: 'g1', fields: ['[sound:kept.mp3]'] });
    await db.put('media', { filename: 'kept.mp3', blob: new Blob(['x']) });
    await db.put('media', { filename: 'orphan.mp3', blob: new Blob(['y']) });

    await sweepOrphanMedia(db);

    expect(await db.get('media', 'kept.mp3')).toBeDefined();
    expect(await db.get('media', 'orphan.mp3')).toBeUndefined();
    db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `deleteDeck`/`sweepOrphanMedia` not exported.

- [ ] **Step 3: Implement `deleteDeck` and `sweepOrphanMedia`**

Append to `src/lib/db/decks.ts`:

```ts
export async function deleteDeck(db: IDBPDatabase<AnkiduckDB>, did: number): Promise<void> {
  const tree = await buildDeckTree(db);

  function findNode(nodes: DeckTreeNode[]): DeckTreeNode | undefined {
    for (const node of nodes) {
      if (node.did === did) return node;
      const found = findNode(node.children);
      if (found) return found;
    }
    return undefined;
  }
  const target = findNode(tree);
  if (!target) return;
  const deleteIds = new Set(collectDeckIds(target));

  const tx = db.transaction(['decks', 'cards', 'cardState', 'notes'], 'readwrite');
  const allCards = await tx.objectStore('cards').getAll();
  const cardsToDelete = allCards.filter((c) => deleteIds.has(c.did));
  const noteIdsToCheck = new Set(cardsToDelete.map((c) => c.nid));

  for (const card of cardsToDelete) {
    await tx.objectStore('cards').delete(card.cid);
    await tx.objectStore('cardState').delete(card.cid);
  }
  for (const id of deleteIds) await tx.objectStore('decks').delete(id);

  const remainingCards = await tx.objectStore('cards').getAll();
  const remainingNoteIds = new Set(remainingCards.map((c) => c.nid));
  for (const nid of noteIdsToCheck) {
    if (!remainingNoteIds.has(nid)) await tx.objectStore('notes').delete(nid);
  }

  await tx.done;
  await sweepOrphanMedia(db);
}

const SOUND_REF_RE = /\[sound:([^\]]+)\]/g;
const IMG_REF_RE = /<img[^>]*\ssrc="([^"]+)"/g;

export async function sweepOrphanMedia(db: IDBPDatabase<AnkiduckDB>): Promise<void> {
  const [notes, allMedia] = await Promise.all([db.getAll('notes'), db.getAll('media')]);
  const referenced = new Set<string>();
  for (const note of notes) {
    for (const value of note.fields) {
      let m: RegExpExecArray | null;
      while ((m = SOUND_REF_RE.exec(value))) referenced.add(m[1]);
      while ((m = IMG_REF_RE.exec(value))) referenced.add(m[1]);
    }
  }
  const tx = db.transaction('media', 'readwrite');
  for (const media of allMedia) {
    if (!referenced.has(media.filename)) await tx.store.delete(media.filename);
  }
  await tx.done;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (5 tests in this file)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/decks.ts src/lib/db/decks.test.ts
git commit -m "Add IndexedDB deck deletion and media orphan sweep"
```

---

## Task 19: Import worker and main-thread controller

**Files:**
- Create: `src/workers/import.worker.ts`
- Create: `src/lib/import/controller.ts`

**Interfaces:**
- Consumes: `extractApkgZip` (Task 10), `parseApkg` (Task 13), `sql.js`'s `initSqlJs`, `mergeImport` (Task 15).
- Produces: `ImportProgress` type, `runImport(file: File, onProgress: (p: ImportProgress) => void, merge: (parsed: ParsedApkg) => Promise<void>): Promise<void>`. Called by the import button handler in `DeckList.svelte` (Task 22).
- No automated test — this task wires together a real Worker, WASM, and `File`/`Blob` APIs that only make sense in a browser. Verified manually in Task 24.

- [ ] **Step 1: Implement the worker entry point**

```ts
// src/workers/import.worker.ts
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { extractApkgZip } from '../lib/apkg/zip';
import { parseApkg } from '../lib/apkg/parse';

export type WorkerOutMessage =
  | { type: 'progress'; phase: 'unzipping' | 'parsing' | 'extracting-media'; pct: number }
  | { type: 'done'; payload: Awaited<ReturnType<typeof parseApkg>> }
  | { type: 'error'; message: string };

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const buffer = new Uint8Array(await event.data.file.arrayBuffer());
    postMessage({ type: 'progress', phase: 'unzipping', pct: 10 } satisfies WorkerOutMessage);
    const extracted = extractApkgZip(buffer);

    postMessage({ type: 'progress', phase: 'parsing', pct: 40 } satisfies WorkerOutMessage);
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
    const parsed = await parseApkg(extracted, SQL);

    postMessage({ type: 'progress', phase: 'extracting-media', pct: 80 } satisfies WorkerOutMessage);
    postMessage({ type: 'done', payload: parsed } satisfies WorkerOutMessage);
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerOutMessage);
  }
};
```

- [ ] **Step 2: Implement the main-thread controller**

```ts
// src/lib/import/controller.ts
import type { ParsedApkg } from '../types';
import type { WorkerOutMessage } from '../../workers/import.worker';

export interface ImportProgress {
  phase: 'idle' | 'unzipping' | 'parsing' | 'extracting-media' | 'merging' | 'done' | 'error';
  pct: number;
  error?: string;
}

export function runImport(
  file: File,
  onProgress: (p: ImportProgress) => void,
  merge: (parsed: ParsedApkg) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/import.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = async (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        onProgress({ phase: msg.phase, pct: msg.pct });
      } else if (msg.type === 'done') {
        onProgress({ phase: 'merging', pct: 90 });
        try {
          await merge(msg.payload);
          onProgress({ phase: 'done', pct: 100 });
          worker.terminate();
          resolve();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          onProgress({ phase: 'error', pct: 0, error: message });
          worker.terminate();
          reject(err);
        }
      } else if (msg.type === 'error') {
        onProgress({ phase: 'error', pct: 0, error: msg.message });
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.postMessage({ file });
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: PASS. (The `?url` import for the wasm asset needs Vite's client types, already covered by the existing `"types": ["svelte", "vite/client"]` in `tsconfig.app.json`.)

- [ ] **Step 4: Commit**

```bash
git add src/workers/import.worker.ts src/lib/import/controller.ts
git commit -m "Add import worker and main-thread controller"
```

---

## Task 20: PWA shell — manifest, service worker, icons, iOS meta

**Files:**
- Modify: `vite.config.ts`
- Create: `scripts/generate-icons.mjs`
- Create (generated): `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Modify: `index.html`
- Modify: `src/app.css`

**Interfaces:**
- Produces: the PWA manifest/service worker registration (via `vite-plugin-pwa`'s virtual module, registered in Task 21's `main.ts` update) and `public/icons/*.png` referenced by the manifest.
- No automated test — verified manually in Task 24 (`npm run build && npm run preview`, checking the manifest and service worker in DevTools).

- [ ] **Step 1: Write the icon generation script**

```js
// scripts/generate-icons.mjs
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';

function cornerInsideRadius(x, y, size, margin) {
  if (x >= margin && x <= size - margin) return true;
  if (y >= margin && y <= size - margin) return true;
  const cx = x < margin ? margin : size - margin;
  const cy = y < margin ? margin : size - margin;
  return Math.hypot(cx - x, cy - y) < margin;
}

function generateIcon(size, outPath) {
  const png = new PNG({ width: size, height: size });
  const margin = size * 0.08;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const inside = cornerInsideRadius(x, y, size, margin);
      if (inside) {
        png.data[idx] = 0xf5;
        png.data[idx + 1] = 0xc5;
        png.data[idx + 2] = 0x1e;
        png.data[idx + 3] = 0xff;
      } else {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
      }
    }
  }
  writeFileSync(outPath, PNG.sync.write(png));
}

mkdirSync('public/icons', { recursive: true });
generateIcon(192, 'public/icons/icon-192.png');
generateIcon(512, 'public/icons/icon-512.png');
console.log('Generated public/icons/icon-192.png and icon-512.png');
```

- [ ] **Step 2: Run the script to generate the icon files**

Run: `node scripts/generate-icons.mjs`
Expected: prints the confirmation message; `public/icons/icon-192.png` and `public/icons/icon-512.png` now exist.

- [ ] **Step 3: Add `VitePWA` to `vite.config.ts`**

```ts
// vite.config.ts
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Ankiduck',
        short_name: 'Ankiduck',
        description: 'Offline spaced-repetition flashcards, import Anki .apkg decks',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1c1c1e',
        theme_color: '#f5c51e',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,svg,png}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
})
```

- [ ] **Step 4: Add iOS PWA meta tags and safe-area viewport to `index.html`**

```html
<!-- index.html: replace the existing <head> contents -->
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#f5c51e" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <title>Ankiduck</title>
  </head>
```

- [ ] **Step 5: Add safe-area and app-like touch CSS to `src/app.css`**

Add at the top of `src/app.css`:

```css
:root {
  --safe-top: env(safe-area-inset-top);
  --safe-bottom: env(safe-area-inset-bottom);
}

html,
body {
  overscroll-behavior: none;
  touch-action: manipulation;
}

body {
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
}
```

- [ ] **Step 6: Verify the production build succeeds and includes PWA assets**

Run: `npm run build`
Expected: PASS, and the build output logs a generated `sw.js` and `manifest.webmanifest` alongside the usual `dist/` assets (vite-plugin-pwa logs this during `generateSW`).

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts scripts/generate-icons.mjs public/icons index.html src/app.css
git commit -m "Add PWA manifest, service worker, icons, and iOS meta tags"
```

---

## Task 21: App shell — view-switching store, App.svelte, ImportProgress.svelte

**Files:**
- Create: `src/lib/stores/app.svelte.ts`
- Create: `src/lib/components/ImportProgress.svelte`
- Modify: `src/App.svelte`
- Modify: `src/main.ts`
- Delete: `src/lib/Counter.svelte`, `src/assets/svelte.svg`, `src/assets/vite.svg`, `src/assets/hero.png`

**Interfaces:**
- Consumes: `ImportProgress` type (Task 19).
- Produces: `appState` (a runes-based store with a `view` property of type `View`), rendered by `App.svelte`. `DeckList.svelte` (Task 22) and `Review.svelte` (Task 23) both read/write `appState.view`.
- No automated test (Svelte components; verified manually, per Global Constraints). Type-checking stands in for a build-correctness check.

- [ ] **Step 1: Remove the create-vite scaffold**

```bash
rm src/lib/Counter.svelte src/assets/svelte.svg src/assets/vite.svg src/assets/hero.png
```

- [ ] **Step 2: Create the view-switching store**

```ts
// src/lib/stores/app.svelte.ts
export type View =
  | { name: 'deckList' }
  | { name: 'importing' }
  | { name: 'review'; deckIds: number[]; deckName: string };

class AppState {
  view = $state<View>({ name: 'deckList' });
}

export const appState = new AppState();
```

- [ ] **Step 3: Create `ImportProgress.svelte`**

```svelte
<!-- src/lib/components/ImportProgress.svelte -->
<script lang="ts">
  import type { ImportProgress } from '../import/controller';

  let { progress }: { progress: ImportProgress } = $props();

  const phaseLabels: Record<ImportProgress['phase'], string> = {
    idle: 'Preparing…',
    unzipping: 'Unzipping deck…',
    parsing: 'Reading cards…',
    'extracting-media': 'Extracting media…',
    merging: 'Saving to device…',
    done: 'Done!',
    error: 'Import failed',
  };
</script>

<section class="import-progress">
  <h1>{phaseLabels[progress.phase]}</h1>
  {#if progress.phase === 'error'}
    <p class="error">{progress.error}</p>
  {:else}
    <progress value={progress.pct} max="100"></progress>
  {/if}
</section>

<style>
  .import-progress {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 1rem;
    padding: 2rem;
    text-align: center;
  }
  .error {
    color: #d33;
  }
</style>
```

- [ ] **Step 4: Rewrite `App.svelte` to switch between views**

```svelte
<!-- src/App.svelte -->
<script lang="ts">
  import DeckList from './lib/components/DeckList.svelte';
  import ImportProgress from './lib/components/ImportProgress.svelte';
  import Review from './lib/components/Review.svelte';
  import { appState } from './lib/stores/app.svelte';
  import type { ImportProgress as ImportProgressType } from './lib/import/controller';

  let currentImportProgress: ImportProgressType = $state({ phase: 'idle', pct: 0 });
</script>

{#if appState.view.name === 'deckList'}
  <DeckList
    onImportStart={() => (appState.view = { name: 'importing' })}
    onImportProgress={(p) => (currentImportProgress = p)}
    onImportDone={() => (appState.view = { name: 'deckList' })}
  />
{:else if appState.view.name === 'importing'}
  <ImportProgress progress={currentImportProgress} />
{:else if appState.view.name === 'review'}
  <Review deckIds={appState.view.deckIds} deckName={appState.view.deckName} onExit={() => (appState.view = { name: 'deckList' })} />
{/if}
```

Note: `DeckList.svelte` and `Review.svelte` are created in Tasks 22-23; this task's type-check will fail until those exist, which is expected and resolved by the next two tasks (this file is authored now so App.svelte's final shape is visible up front, but the `check` step below is deferred to Task 23).

- [ ] **Step 5: Update `main.ts`'s title text (cosmetic parity with `index.html`)**

`src/main.ts` needs no functional change — `mount(App, { target: ... })` is already correct. Confirm it still reads exactly:

```ts
// src/main.ts
import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
```

- [ ] **Step 6: Commit**

```bash
git add -A src/lib/stores src/lib/components/ImportProgress.svelte src/App.svelte
git rm src/lib/Counter.svelte src/assets/svelte.svg src/assets/vite.svg src/assets/hero.png
git commit -m "Add app view-switching store, App.svelte shell, ImportProgress view"
```

---

## Task 22: DeckList.svelte

**Files:**
- Create: `src/lib/components/DeckTreeRow.svelte`
- Create: `src/lib/components/DeckList.svelte`

**Interfaces:**
- Consumes: `buildDeckTree`, `deleteDeck`, `collectDeckIds`, `DeckTreeNode` (Task 17-18); `openAnkiduckDb` (Task 14); `runImport` (Task 19); `mergeImport` (Task 15); `appState` (Task 21).
- Produces: the `DeckList` component used by `App.svelte` (Task 21), with props `onImportStart: () => void`, `onImportProgress: (p: ImportProgress) => void`, `onImportDone: () => void`.
- No automated test (Svelte component; verified manually per Global Constraints).

- [ ] **Step 1: Create the recursive tree-row component**

```svelte
<!-- src/lib/components/DeckTreeRow.svelte -->
<script lang="ts">
  import type { DeckTreeNode } from '../db/decks';
  import DeckTreeRow from './DeckTreeRow.svelte';

  let {
    node,
    onOpen,
    onDelete,
  }: {
    node: DeckTreeNode;
    onOpen: (node: DeckTreeNode) => void;
    onDelete: (node: DeckTreeNode) => void;
  } = $props();

  let expanded = $state(true);
</script>

<li>
  <div class="row">
    {#if node.children.length > 0}
      <button class="toggle" onclick={() => (expanded = !expanded)}>{expanded ? '▾' : '▸'}</button>
    {:else}
      <span class="toggle-spacer"></span>
    {/if}
    <button class="deck-name" onclick={() => onOpen(node)} disabled={node.did === null}>
      {node.segment}
    </button>
    <span class="counts">
      {#if node.newCount > 0}<span class="new">{node.newCount}</span>{/if}
      {#if node.learningCount > 0}<span class="learning">{node.learningCount}</span>{/if}
      {#if node.dueCount > 0}<span class="due">{node.dueCount}</span>{/if}
    </span>
    {#if node.did !== null}
      <button class="delete" onclick={() => onDelete(node)} aria-label="Delete deck">✕</button>
    {/if}
  </div>
  {#if expanded && node.children.length > 0}
    <ul>
      {#each node.children as child (child.fullPath)}
        <DeckTreeRow node={child} {onOpen} {onDelete} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
  }
  .deck-name {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    font-size: 1rem;
  }
  .toggle,
  .toggle-spacer {
    width: 1.5rem;
  }
  .counts span {
    display: inline-block;
    min-width: 1.5rem;
    text-align: center;
    border-radius: 0.25rem;
    padding: 0 0.25rem;
    margin-left: 0.25rem;
    font-size: 0.85rem;
  }
  .new {
    background: #4a90d9;
    color: white;
  }
  .learning {
    background: #d9534f;
    color: white;
  }
  .due {
    background: #5cb85c;
    color: white;
  }
  .delete {
    background: none;
    border: none;
    color: #d33;
  }
  ul {
    list-style: none;
    padding-left: 1.5rem;
    margin: 0;
  }
</style>
```

- [ ] **Step 2: Create `DeckList.svelte`**

```svelte
<!-- src/lib/components/DeckList.svelte -->
<script lang="ts">
  import { openAnkiduckDb } from '../db/schema';
  import { buildDeckTree, deleteDeck, collectDeckIds, type DeckTreeNode } from '../db/decks';
  import { mergeImport } from '../db/content';
  import { runImport, type ImportProgress } from '../import/controller';
  import { appState } from '../stores/app.svelte';
  import DeckTreeRow from './DeckTreeRow.svelte';

  let {
    onImportStart,
    onImportProgress,
    onImportDone,
  }: {
    onImportStart: () => void;
    onImportProgress: (p: ImportProgress) => void;
    onImportDone: () => void;
  } = $props();

  let tree: DeckTreeNode[] = $state([]);
  let resetScheduling = $state(false);
  let fileInput: HTMLInputElement;

  async function refresh() {
    const db = await openAnkiduckDb();
    tree = await buildDeckTree(db);
    db.close();
  }

  $effect(() => {
    refresh();
  });

  async function handleFileChosen(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    onImportStart();
    try {
      await runImport(file, onImportProgress, async (parsed) => {
        const db = await openAnkiduckDb();
        await mergeImport(db, parsed, resetScheduling);
        db.close();
      });
    } catch {
      // runImport already reports the error via onImportProgress; nothing further to do here.
    }
    await refresh();
    onImportDone();
    (event.target as HTMLInputElement).value = '';
  }

  function openDeck(node: DeckTreeNode) {
    if (node.did === null) return;
    appState.view = { name: 'review', deckIds: collectDeckIds(node), deckName: node.fullPath };
  }

  async function removeDeck(node: DeckTreeNode) {
    if (node.did === null) return;
    if (!confirm(`Delete "${node.fullPath}" and all its cards?`)) return;
    const db = await openAnkiduckDb();
    await deleteDeck(db, node.did);
    db.close();
    await refresh();
  }
</script>

<section class="deck-list">
  <h1>Ankiduck</h1>

  <label class="reset-toggle">
    <input type="checkbox" bind:checked={resetScheduling} />
    Reset scheduling on import
  </label>

  <button onclick={() => fileInput.click()}>Import .apkg</button>
  <input bind:this={fileInput} type="file" accept=".apkg" hidden onchange={handleFileChosen} />

  {#if tree.length === 0}
    <p>No decks yet. Import a .apkg file to get started.</p>
  {:else}
    <ul>
      {#each tree as node (node.fullPath)}
        <DeckTreeRow {node} onOpen={openDeck} onDelete={removeDeck} />
      {/each}
    </ul>
  {/if}
</section>

<style>
  .deck-list {
    max-width: 480px;
    margin: 0 auto;
    padding: 1rem;
  }
  .reset-toggle {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.9rem;
  }
  ul {
    list-style: none;
    padding: 0;
  }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/DeckTreeRow.svelte src/lib/components/DeckList.svelte
git commit -m "Add DeckList view with import, delete, and deck tree"
```

---

## Task 23: Review.svelte

**Files:**
- Create: `src/lib/components/Review.svelte`

**Interfaces:**
- Consumes: `renderCard` (Task 6); `getSessionQueueForDeck` (Task 17); `gradeCard` (Task 16); `openAnkiduckDb` (Task 14); `Grade`, `Note`, `NoteType`, `Card` (Task 2).
- Produces: the `Review` component used by `App.svelte` (Task 21), with props `deckIds: number[]`, `deckName: string`, `onExit: () => void`.
- No automated test (Svelte component; verified manually per Global Constraints).

- [ ] **Step 1: Create `Review.svelte`**

```svelte
<!-- src/lib/components/Review.svelte -->
<script lang="ts">
  import { tick } from 'svelte';
  import { openAnkiduckDb } from '../db/schema';
  import { getSessionQueueForDeck } from '../db/decks';
  import { gradeCard } from '../db/cardState';
  import { renderCard } from '../template/render';
  import { nextState } from '../scheduler/schedule';
  import type { Grade, Note, NoteType, Card, CardState } from '../types';

  let { deckIds, deckName, onExit }: { deckIds: number[]; deckName: string; onExit: () => void } = $props();

  let queueCids: number[] = $state([]);
  let currentIndex = $state(0);
  let revealed = $state(false);
  let frontHtml = $state('');
  let backHtml = $state('');
  let previews: Record<Grade, string> = $state({ again: '', hard: '', good: '', easy: '' });
  let currentCid: number | null = $state(null);

  async function loadQueue() {
    const db = await openAnkiduckDb();
    const queue = await getSessionQueueForDeck(db, deckIds);
    db.close();
    queueCids = queue.map((c) => c.cid);
    currentIndex = 0;
    await loadCurrentCard();
  }

  async function loadCurrentCard() {
    revealed = false;
    if (currentIndex >= queueCids.length) {
      currentCid = null;
      return;
    }
    currentCid = queueCids[currentIndex];

    const db = await openAnkiduckDb();
    const card = (await db.get('cards', currentCid)) as Card;
    const note = (await db.get('notes', card.nid)) as Note;
    const noteType = (await db.get('noteTypes', note.mid)) as NoteType;
    const mediaFiles = await db.getAll('media');
    const state = (await db.get('cardState', currentCid)) as CardState;
    db.close();

    const mediaUrlMap = new Map(mediaFiles.map((m) => [m.filename, URL.createObjectURL(m.blob)]));
    const rendered = renderCard(note, noteType, card.ord, mediaUrlMap);
    frontHtml = rendered.front;
    backHtml = rendered.back;

    const grades: Grade[] = ['again', 'hard', 'good', 'easy'];
    const nextPreviews: Record<Grade, string> = { again: '', hard: '', good: '', easy: '' };
    for (const grade of grades) {
      nextPreviews[grade] = formatIntervalPreview(nextState(state, grade));
    }
    previews = nextPreviews;
  }

  function formatIntervalPreview(state: CardState): string {
    if (state.queue === 'learning' || state.queue === 'relearning') {
      const minutes = Math.round((state.due - Date.now()) / 60_000);
      return `${Math.max(1, minutes)}m`;
    }
    return `${state.ivl}d`;
  }

  async function reveal() {
    revealed = true;
    await tick(); // wait for {@html backHtml} to be in the DOM before querying it
    const audio = document.querySelector<HTMLAudioElement>('.review-card audio.ankiduck-audio');
    audio?.play().catch(() => {
      // iOS autoplay was blocked; the visible replay control still lets the user play it manually.
    });
  }

  async function grade(g: Grade) {
    if (currentCid === null) return;
    const db = await openAnkiduckDb();
    await gradeCard(db, currentCid, g);
    db.close();
    currentIndex += 1;
    await loadCurrentCard();
  }

  $effect(() => {
    loadQueue();
  });
</script>

<section class="review">
  <header>
    <button onclick={onExit}>← {deckName}</button>
  </header>

  {#if currentCid === null}
    <p class="done">All done for now!</p>
  {:else}
    <div class="review-card">
      {@html revealed ? backHtml : frontHtml}
    </div>

    {#if !revealed}
      <button class="show-answer" onclick={reveal}>Show Answer</button>
    {:else}
      <div class="grades">
        <button onclick={() => grade('again')}>Again<span>{previews.again}</span></button>
        <button onclick={() => grade('hard')}>Hard<span>{previews.hard}</span></button>
        <button onclick={() => grade('good')}>Good<span>{previews.good}</span></button>
        <button onclick={() => grade('easy')}>Easy<span>{previews.easy}</span></button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .review {
    max-width: 480px;
    margin: 0 auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .review-card {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1rem;
  }
  .show-answer {
    padding: 1rem;
    font-size: 1.1rem;
  }
  .grades {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }
  .grades button {
    display: flex;
    flex-direction: column;
    padding: 0.75rem 0.25rem;
  }
  .grades span {
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .done {
    text-align: center;
    margin-top: 4rem;
  }
</style>
```

- [ ] **Step 2: Verify the full app type-checks now that all three views exist**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Review.svelte
git commit -m "Add Review view with grading, interval previews, and audio autoplay"
```

---

## Task 24: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Build and preview**

```bash
npm run build && npm run preview
```

Expected: build succeeds; preview server starts.

- [ ] **Step 2: Obtain a valid `.apkg` for manual testing**

The repo-root `Swedish 8k.apkg` is corrupted (see Global Constraints). Before this step, re-export it from Anki Desktop (File → Export → "Anki Deck Package", with "Support older Anki versions" checked so it uses the legacy `collection.anki2` schema this MVP supports) or obtain a fresh working copy, and replace the file at the repo root.

- [ ] **Step 3: Manually verify the import → review → PWA flow in a desktop browser**

Open the preview URL and check:
- Import button opens a file picker; selecting the fixed `.apkg` shows import progress and lands back on a populated deck list.
- Deck tree shows correct nesting and new/due counts.
- Opening a deck enters review; front renders, "Show Answer" reveals the back with interval previews on each grade button; grading advances to the next card and the deck list counts update afterward.
- Deleting a deck removes it and its cards.
- Re-importing the same file does not duplicate decks/cards.

- [ ] **Step 4: Manually verify on iOS Safari (iPhone or Simulator)**

- Add to Home Screen from Safari; launch the installed icon and confirm it opens in standalone mode (no browser chrome) with content clear of the notch/home indicator.
- Turn on Airplane Mode after the first load and confirm the app still opens and functions (service worker precache).
- Run through the same import → review flow via the Files app file picker; confirm audio (if the deck has any) plays on answer reveal or via the replay control.

- [ ] **Step 5: Note results**

No commit for this task — it's a verification checklist. If any check fails, file it as a follow-up fix (small, targeted commits against the relevant task's files) rather than editing this plan.
