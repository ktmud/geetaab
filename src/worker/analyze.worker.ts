import { analyzeAudio, type AnalysisResult } from '../core/analyze';

export interface AnalyzeRequest {
  samples: Float32Array;
  sampleRate: number;
  tempoHint?: number;
  beatsPerBar?: number;
}

export type AnalyzeResponse =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { samples, sampleRate, tempoHint, beatsPerBar } = event.data;
  const post = (message: AnalyzeResponse): void => {
    (self as unknown as Worker).postMessage(message);
  };
  try {
    const result = analyzeAudio(samples, sampleRate, {
      tempoHint,
      beatsPerBar,
      onProgress: (stage, fraction) => post({ type: 'progress', stage, fraction }),
    });
    post({ type: 'done', result });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
