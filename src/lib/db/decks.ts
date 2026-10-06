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

export async function buildDeckTree(
  db: IDBPDatabase<AnkiduckDB>,
  now: number = Date.now()
): Promise<DeckTreeNode[]> {
  const [decks, cards, states] = await Promise.all([
    db.getAll('decks'),
    db.getAll('cards'),
    db.getAll('cardState'),
  ]);
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
  const [cards, states] = await Promise.all([db.getAll('cards'), db.getAll('cardState')]);
  const stateByCid = new Map(states.map((s) => [s.cid, s]));
  const wantedDids = new Set(deckIds);
  const queueCards: QueueCard[] = [];
  for (const card of cards) {
    if (!wantedDids.has(card.did)) continue;
    const state = stateByCid.get(card.cid);
    if (state) queueCards.push({ cid: card.cid, nid: card.nid, queue: state.queue, due: state.due });
  }
  return buildSessionQueue(queueCards, now);
}

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
