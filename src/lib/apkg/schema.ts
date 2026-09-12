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

export function parseModernSchemaUnsupported(): never {
  throw new Error(
    "This deck uses a newer note-type format Ankiduck doesn't support yet — re-export from Anki with 'Support older Anki versions' checked."
  );
}
