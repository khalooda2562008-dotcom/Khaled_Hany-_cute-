import { fetchFile } from '@ffmpeg/util';
import { withFFmpegLock } from './ffmpeg';
import type { SilenceRange } from '../types/editor';
import { uid } from '../utils/format';

/**
 * Turns the `silencedetect` log lines into reviewable ranges.
 * Pure on purpose: the phone cannot run FFmpeg in tests, but the parsing and
 * clamping rules are the part that used to break the "auto cut" flow.
 */
export function parseSilenceLog(text: string, minimumSeconds: number): SilenceRange[] {
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

/** True when FFmpeg's probe output shows an audio stream for the input. */
export function logHasAudioStream(text: string): boolean {
  return /Stream #\d+:\d+.*Audio:/.test(text);
}

export async function detectSilence(blob: Blob, thresholdDb = -35, minimumSeconds = 1.1): Promise<SilenceRange[]> {
  const logs = await withFFmpegLock(async ffmpeg => {
    const filename = `silence_${uid('scan')}.mp4`;
    const output: string[] = [];
    const handler = ({ message }: { message: string }) => output.push(message);
    ffmpeg.on('log', handler);
    try {
      await ffmpeg.writeFile(filename, await fetchFile(blob));
      try {
        await ffmpeg.exec(['-i', filename, '-af', `silencedetect=noise=${thresholdDb}dB:d=${minimumSeconds}`, '-f', 'null', '-']);
      } catch {
        // A video without an audio track makes `-af` fail. The log still holds
        // the probe output, so decide below instead of surfacing a cryptic error.
      }
    } finally {
      ffmpeg.off('log', handler);
      await ffmpeg.deleteFile(filename).catch(() => undefined);
    }
    return output;
  });

  const text = logs.join('\n');
  if (!logHasAudioStream(text)) {
    throw new Error('هذا الفيديو لا يحتوي على مسار صوتي، لذلك لا يوجد صمت يمكن قصه. أضف فيديو بصوت ثم أعد المحاولة.');
  }
  return parseSilenceLog(text, minimumSeconds);
}
