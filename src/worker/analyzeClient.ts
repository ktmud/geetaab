import { analyzeAudio, type AnalysisResult } from '../core/analyze';
import type { AnalyzeRequest, AnalyzeResponse } from './analyze.worker';

export interface AnalyzeClientOptions {
  onProgress?: (stage: string, fraction: number) => void;
  tempoHint?: number;
  beatsPerBar?: number;
  signal?: AbortSignal;
}

/**
 * Run the analysis off the main thread.
 *
 * A three-minute recording is a few seconds of arithmetic; on the main thread
 * that freezes the page, including the progress indicator that is meant to
 * explain the wait. Falls back to a synchronous run where Workers are blocked.
 */
export function analyzeInWorker(
  samples: Float32Array,
  sampleRate: number,
  opts: AnalyzeClientOptions = {},
): Promise<AnalysisResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(
      analyzeAudio(samples, sampleRate, {
        onProgress: opts.onProgress,
        tempoHint: opts.tempoHint,
        beatsPerBar: opts.beatsPerBar,
      }),
    );
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = (): void => {
      worker.terminate();
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('Analysis cancelled', 'AbortError'));
    };
    opts.signal?.addEventListener('abort', onAbort);

    worker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        opts.onProgress?.(message.stage, message.fraction);
      } else if (message.type === 'done') {
        cleanup();
        resolve(message.result);
      } else {
        cleanup();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'The analyser crashed.'));
    };

    // Transfer rather than copy: the samples are megabytes and the caller is
    // done with them once analysis starts.
    const copy = samples.slice();
    const request: AnalyzeRequest = {
      samples: copy,
      sampleRate,
      tempoHint: opts.tempoHint,
      beatsPerBar: opts.beatsPerBar,
    };
    worker.postMessage(request, [copy.buffer]);
  });
}
