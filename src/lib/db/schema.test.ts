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
