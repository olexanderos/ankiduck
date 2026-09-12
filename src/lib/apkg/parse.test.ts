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
  db.run('INSERT INTO notes VALUES (1000,"g1",100,0,0,"","hej\x1fhello","hej",0,0,"")');
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
