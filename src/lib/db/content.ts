import type { IDBPDatabase } from 'idb';
import type { AnkiduckDB } from './schema';
import type { ParsedApkg, CardState } from '../types';

export async function mergeImport(
  db: IDBPDatabase<AnkiduckDB>,
  parsed: ParsedApkg,
  resetScheduling: boolean
): Promise<void> {
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
