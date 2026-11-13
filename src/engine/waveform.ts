import { fetchFile } from '@ffmpeg/util';
import { withFFmpegLock } from './ffmpeg';
import { uid } from '../utils/format';

/** Extracts low-rate mono PCM with FFmpeg and returns actual per-window peak amplitudes. */
export async function extractWaveform(blob: Blob, bars = 100): Promise<number[]> {
  return withFFmpegLock(async ffmpeg => {
    const source = `wave_${uid('source')}.mp4`;
    const pcm = `wave_${uid('pcm')}.pcm`;
    try {
      await ffmpeg.writeFile(source, await fetchFile(blob));
      const code = await ffmpeg.exec(['-i', source, '-vn', '-ac', '1', '-ar', '4000', '-f', 's16le', pcm]);
      if (code !== 0) throw new Error('Audio stream could not be decoded.');
      const bytes = await ffmpeg.readFile(pcm);
      if (typeof bytes === 'string') throw new Error('Audio stream could not be decoded.');
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
      const samples = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      if (!samples.length) return [];
      const result: number[] = [];
      const chunk = Math.max(1, Math.floor(samples.length / bars));
      for (let i = 0; i < bars; i++) {
        const start = i * chunk;
        const end = i === bars - 1 ? samples.length : Math.min(samples.length, start + chunk);
        let peak = 0;
        for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]) / 32768);
        result.push(Math.max(7, Math.round(peak * 100)));
      }
      return result;
    } finally {
      await Promise.all([source, pcm].map(name => ffmpeg.deleteFile(name).catch(() => undefined)));
    }
  });
}
