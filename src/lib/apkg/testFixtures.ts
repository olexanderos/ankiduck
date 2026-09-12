import { zipSync } from 'fflate';

/** Builds a minimal in-memory .apkg zip for tests. Not used in production code. */
export function buildFixtureApkgBytes(
  collectionBytes: Uint8Array,
  mediaFiles: Record<string, Uint8Array> = { '0': new Uint8Array([1, 2, 3, 4]) },
  collectionFilename: 'collection.anki2' | 'collection.anki21' = 'collection.anki2'
): Uint8Array {
  const manifestNames: Record<string, string> = {};
  Object.keys(mediaFiles).forEach((key, i) => {
    manifestNames[key] = `media-${i}.bin`;
  });
  return zipSync({
    [collectionFilename]: collectionBytes,
    media: new TextEncoder().encode(JSON.stringify(manifestNames)),
    ...mediaFiles,
  });
}
