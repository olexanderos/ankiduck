import { unzipSync } from 'fflate';

export interface ExtractedApkg {
  collectionBytes: Uint8Array;
  mediaManifest: Record<string, string>; // "0" -> real filename
  mediaEntries: Record<string, Uint8Array>; // "0" -> raw file bytes
}

export function extractApkgZip(zipBytes: Uint8Array): ExtractedApkg {
  const files = unzipSync(zipBytes);

  const collectionName = files['collection.anki21']
    ? 'collection.anki21'
    : files['collection.anki2']
      ? 'collection.anki2'
      : null;

  if (!collectionName) {
    if (files['collection.anki21b']) {
      throw new Error(
        "This deck uses a newer compressed format Ankiduck doesn't support yet — re-export from Anki with 'Support older Anki versions' checked."
      );
    }
    throw new Error('No collection database found in this .apkg file.');
  }

  const mediaManifest: Record<string, string> = files['media']
    ? JSON.parse(new TextDecoder().decode(files['media']))
    : {};

  const mediaEntries: Record<string, Uint8Array> = {};
  for (const key of Object.keys(mediaManifest)) {
    if (files[key]) mediaEntries[key] = files[key];
  }

  return { collectionBytes: files[collectionName], mediaManifest, mediaEntries };
}
