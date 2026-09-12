import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type SqlJsStatic, type Database } from 'sql.js';
import { hasNotetypesTable, parseLegacyDecksAndModels, parseModernSchemaUnsupported } from './schema';

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
