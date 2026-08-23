import { toMono } from '../core/dsp';
import { audioContextCtor } from './context';

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

/** Decode any container the browser supports into mono samples. */
export async function decodeAudioFile(input: File | ArrayBuffer): Promise<DecodedAudio> {
  const data = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const ctx = new (audioContextCtor())();
  try {
    const buffer = await ctx.decodeAudioData(data.slice(0));
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    return {
      samples: toMono(channels),
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
    };
  } finally {
    await ctx.close();
  }
}
