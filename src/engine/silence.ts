import { fetchFile } from '@ffmpeg/util';
import { withFFmpegLock } from './ffmpeg';
import type { SilenceRange } from '../types/editor';
import { uid } from '../utils/format';

export async function detectSilence(blob: Blob, thresholdDb = -35, minimumSeconds = 1.1): Promise<SilenceRange[]> {
  const logs = await withFFmpegLock(async ffmpeg => {
    const filename = `silence_${uid('scan')}.mp4`;
    const output: string[] = [];
    const handler = ({ message }: { message: string }) => output.push(message);
    ffmpeg.on('log', handler);
    try {
      await ffmpeg.writeFile(filename, await fetchFile(blob));
      await ffmpeg.exec(['-i', filename, '-af', `silencedetect=noise=${thresholdDb}dB:d=${minimumSeconds}`, '-f', 'null', '-']);
    } finally {
      ffmpeg.off('log', handler);
      await ffmpeg.deleteFile(filename).catch(() => undefined);
    }
    return output;
  });
  const text = logs.join('\n');
  const starts = [...text.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
  const ends = [...text.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
  const ranges: SilenceRange[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = Math.max(0, starts[i]);
    const end = Math.max(start, ends[i] ?? start);
    if (end - start >= minimumSeconds) ranges.push({ start, end, duration: end - start });
  }
  return ranges;
}
