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
