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
