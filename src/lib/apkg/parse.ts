import type { SqlJsStatic } from 'sql.js';
import type { ExtractedApkg } from './zip';
import type { ParsedApkg, Note, Card } from '../types';
import { hasNotetypesTable, parseLegacyDecksAndModels, parseModernSchemaUnsupported } from './schema';

/** Anki separates a note's field values with the ASCII unit separator. */
const FIELD_SEPARATOR = '\x1f';

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
          fields: (row[3] as string).split(FIELD_SEPARATOR),
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
        blob: new Blob([extracted.mediaEntries[key] as BlobPart]),
      }));

    return { decks, noteTypes, notes, cards, media };
  } finally {
    db.close();
  }
}
