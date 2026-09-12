import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { extractApkgZip } from '../lib/apkg/zip';
import { parseApkg } from '../lib/apkg/parse';

export type WorkerOutMessage =
  | { type: 'progress'; phase: 'unzipping' | 'parsing' | 'extracting-media'; pct: number }
  | { type: 'done'; payload: Awaited<ReturnType<typeof parseApkg>> }
  | { type: 'error'; message: string };

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const buffer = new Uint8Array(await event.data.file.arrayBuffer());
    postMessage({ type: 'progress', phase: 'unzipping', pct: 10 } satisfies WorkerOutMessage);
    const extracted = extractApkgZip(buffer);

    postMessage({ type: 'progress', phase: 'parsing', pct: 40 } satisfies WorkerOutMessage);
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
    const parsed = await parseApkg(extracted, SQL);

    postMessage({ type: 'progress', phase: 'extracting-media', pct: 80 } satisfies WorkerOutMessage);
    postMessage({ type: 'done', payload: parsed } satisfies WorkerOutMessage);
  } catch (err) {
    postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerOutMessage);
  }
};
