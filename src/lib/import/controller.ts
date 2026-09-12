import type { ParsedApkg } from '../types';
import type { WorkerOutMessage } from '../../workers/import.worker';

export interface ImportProgress {
  phase: 'idle' | 'unzipping' | 'parsing' | 'extracting-media' | 'merging' | 'done' | 'error';
  pct: number;
  error?: string;
}

export function runImport(
  file: File,
  onProgress: (p: ImportProgress) => void,
  merge: (parsed: ParsedApkg) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/import.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = async (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        onProgress({ phase: msg.phase, pct: msg.pct });
      } else if (msg.type === 'done') {
        onProgress({ phase: 'merging', pct: 90 });
        try {
          await merge(msg.payload);
          onProgress({ phase: 'done', pct: 100 });
          worker.terminate();
          resolve();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          onProgress({ phase: 'error', pct: 0, error: message });
          worker.terminate();
          reject(err);
        }
      } else if (msg.type === 'error') {
        onProgress({ phase: 'error', pct: 0, error: msg.message });
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.postMessage({ file });
  });
}
