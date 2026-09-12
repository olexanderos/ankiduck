import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { extractApkgZip } from './zip';
import { buildFixtureApkgBytes } from './testFixtures';

describe('extractApkgZip', () => {
  it('extracts the collection.anki2 bytes when present', () => {
    const collection = new Uint8Array([9, 9, 9]);
    const zip = buildFixtureApkgBytes(collection);
    const result = extractApkgZip(zip);
    expect(Array.from(result.collectionBytes)).toEqual([9, 9, 9]);
  });

  it('prefers collection.anki21 over collection.anki2 when both are present', () => {
    const zip = zipSync({
      'collection.anki2': new Uint8Array([1]),
      'collection.anki21': new Uint8Array([2]),
      media: new TextEncoder().encode('{}'),
    });
    const result = extractApkgZip(zip);
    expect(Array.from(result.collectionBytes)).toEqual([2]);
  });

  it('decodes the media manifest and matching entries', () => {
    const zip = buildFixtureApkgBytes(new Uint8Array([1]), { '0': new Uint8Array([7, 7]) });
    const result = extractApkgZip(zip);
    expect(result.mediaManifest['0']).toBe('media-0.bin');
    expect(Array.from(result.mediaEntries['0'])).toEqual([7, 7]);
  });

  it('throws a clear error for zstd-compressed collections', () => {
    const zip = zipSync({ 'collection.anki21b': new Uint8Array([1]), media: new TextEncoder().encode('{}') });
    expect(() => extractApkgZip(zip)).toThrow(/newer compressed format/);
  });

  it('throws a clear error when no collection file is found at all', () => {
    const zip = zipSync({ media: new TextEncoder().encode('{}') });
    expect(() => extractApkgZip(zip)).toThrow(/No collection database/);
  });
});
