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
