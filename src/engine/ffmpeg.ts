import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { AudioSettings, ColorSettings, ExportResolution, TimelineClip } from '../types/editor';
import { uid } from '../utils/format';

type ProgressCallback = (progress: number, message: string) => void;
let engine: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let progressTarget: ProgressCallback | undefined;
let executionQueue: Promise<void> = Promise.resolve();

export async function getFFmpeg(onProgress?: ProgressCallback): Promise<FFmpeg> {
  progressTarget = onProgress;
  if (engine?.loaded) return engine;
  if (loading) return loading;
  loading = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => progressTarget?.(Math.max(0, Math.min(1, progress)), 'جارٍ تجهيز الفيديو...'));
    ffmpeg.on('log', ({ message }) => {
      if (/error|failed|invalid/i.test(message)) progressTarget?.(0, message.slice(0, 180));
    });
    // Single-threaded core avoids SharedArrayBuffer/COOP/COEP requirements on mobile hosting.
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
    const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
    await ffmpeg.load({ coreURL, wasmURL });
    engine = ffmpeg;
    return ffmpeg;
  })().finally(() => { loading = null; });
  return loading;
}

/** Serialize access to the single FFmpeg.wasm worker; concurrent jobs can corrupt the virtual filesystem. */
export function withFFmpegLock<T>(job: (ffmpeg: FFmpeg) => Promise<T>, onProgress?: ProgressCallback): Promise<T> {
  const run = executionQueue.then(async () => job(await getFFmpeg(onProgress)));
  executionQueue = run.then(() => undefined, () => undefined);
  return run;
}

export interface ExportInput {
  clips: TimelineClip[];
  media: Map<string, Blob>;
  sourceWidth?: number;
  sourceHeight?: number;
  color: ColorSettings;
  audio: AudioSettings;
  resolution: ExportResolution;
  aspectRatio: string;
  onProgress?: ProgressCallback;
}

function videoSize(resolution: ExportResolution, ratio: string, sourceWidth = 1280, sourceHeight = 720): { width: number; height: number } {
  let aspect = sourceWidth / Math.max(1, sourceHeight);
  if (ratio === '9:16') aspect = 9 / 16;
  else if (ratio === '16:9') aspect = 16 / 9;
  else if (ratio === '1:1') aspect = 1;
  else if (ratio === '4:5') aspect = 4 / 5;

  if (resolution === 'source' && ratio === 'original') {
    // H.264 yuv420p requires even dimensions; round down by at most one pixel.
    return { width: Math.max(2, Math.floor(sourceWidth / 2) * 2), height: Math.max(2, Math.floor(sourceHeight / 2) * 2) };
  }

  const longSide = resolution === '720p' ? 1280 : resolution === '1080p' ? 1920 : Math.max(sourceWidth, sourceHeight);
  // Keep the long edge at the chosen export size. Portrait 9:16 therefore becomes 1080x1920 at 1080p,
  // while 4:5 becomes 1080x1350 instead of an incorrectly oversized 1536x1920 frame.
  const width = aspect >= 1 ? longSide : Math.round(longSide * aspect);
  const height = aspect >= 1 ? Math.round(longSide / aspect) : longSide;
  return { width: Math.max(2, Math.floor(width / 2) * 2), height: Math.max(2, Math.floor(height / 2) * 2) };
}

async function inputHasAudio(ffmpeg: FFmpeg, filename: string): Promise<boolean> {
  const lines: string[] = [];
  const handler = ({ message }: { message: string }) => lines.push(message);
  ffmpeg.on('log', handler);
  try { await ffmpeg.exec(['-i', filename]); } catch { /* no output target is expected to return a non-zero status */ }
  finally { ffmpeg.off('log', handler); }
  return lines.some(line => /Stream .*Audio:/.test(line));
}

function atempoChain(speed: number): string[] {
  let remaining = Math.max(0.25, Math.min(4, speed));
  const filters: string[] = [];
  while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
  while (remaining > 2) { filters.push('atempo=2'); remaining /= 2; }
  filters.push(`atempo=${remaining}`);
  return filters;
}

export async function exportMp4(input: ExportInput): Promise<Blob> {
  if (!input.clips.length) throw new Error('أضف مقطعًا إلى الخط الزمني أولًا.');
  if (input.clips.some(c => !input.media.has(c.mediaId))) throw new Error('هناك ملف مصدر مفقود. أعد استيراد الملف قبل التصدير.');
  return withFFmpegLock(async ffmpeg => {
    const inputNames: string[] = [];
    let outputName: string | null = null;
    try {
      const args: string[] = [];
      const audioInputIndexes: number[] = [];
      for (const [index, clip] of input.clips.entries()) {
        const blob = input.media.get(clip.mediaId)!;
        const mimeExtension = blob.type.split('/')[1]?.replace('quicktime', 'mov').replace('x-matroska', 'mkv');
        const fileExtension = mimeExtension || 'mp4';
        const name = `source_${index}_${uid('media')}.${fileExtension}`;
        await ffmpeg.writeFile(name, await fetchFile(blob));
        inputNames.push(name);
        args.push('-ss', String(Math.max(0, clip.start)), '-t', String(Math.max(0.05, clip.end - clip.start)), '-i', name);
      }

      // Keep video clips with no audio stream renderable by adding a silent audio source.
      let nextInputIndex = input.clips.length;
      for (let i = 0; i < input.clips.length; i++) {
        const hasAudio = await inputHasAudio(ffmpeg, inputNames[i]);
        if (hasAudio) audioInputIndexes.push(i);
        else {
          audioInputIndexes.push(nextInputIndex++);
          const clipDuration = Math.max(0.05, input.clips[i].end - input.clips[i].start);
          args.push('-f', 'lavfi', '-t', String(clipDuration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
        }
      }

      const filters: string[] = [];
      const dimensions = videoSize(input.resolution, input.aspectRatio, input.sourceWidth, input.sourceHeight);
      const target = dimensions.width && dimensions.height ? dimensions : { width: input.sourceWidth || 1280, height: input.sourceHeight || 720 };
      input.clips.forEach((clip, index) => {
        const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
        const eq = `eq=brightness=${input.color.brightness + input.color.exposure}:contrast=${input.color.contrast}:saturation=${input.color.saturation}`;
        const scalePad = `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2`;
        filters.push(`[${index}:v]setpts=(PTS-STARTPTS)/${speed},${scalePad},setsar=1,${eq}[v${index}]`);
        const audioFilters = atempoChain(speed);
        if (input.audio.highpass) audioFilters.push('highpass=f=80');
        if (input.audio.noiseReduction) audioFilters.push('afftdn=nf=-25');
        if (input.audio.normalize) audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
        audioFilters.push(`volume=${clip.muted ? 0 : Math.max(0, Math.min(3, input.audio.gain * clip.volume))}`);
        filters.push(`[${audioInputIndexes[index]}:a]${audioFilters.join(',')}[a${index}]`);
      });
      const concatInputs = input.clips.map((_, index) => `[v${index}][a${index}]`).join('');
      filters.push(`${concatInputs}concat=n=${input.clips.length}:v=1:a=1[vout][aout]`);
      outputName = `khaled-cut-export-${uid('render')}.mp4`;
      args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-threads', '1', '-movflags', '+faststart', outputName);
      input.onProgress?.(0.03, 'جارٍ تشغيل محرك FFmpeg...');
      const code = await ffmpeg.exec(args);
      if (code !== 0) throw new Error('تعذر إكمال التصدير. تأكد من أن ترميز الفيديو مدعوم وأن مساحة وذاكرة الهاتف كافيتان.');
      const output = await ffmpeg.readFile(outputName);
      const blob = new Blob([output as BlobPart], { type: 'video/mp4' });
      if (blob.size < 1024) throw new Error('ملف التصدير الناتج غير صالح أو فارغ.');
      input.onProgress?.(1, 'اكتمل التصدير بنجاح.');
      return blob;
    } finally {
      const temporaryFiles = outputName ? [...inputNames, outputName] : inputNames;
      await Promise.all(temporaryFiles.map(name => ffmpeg.deleteFile(name).catch(() => undefined)));
    }
  }, input.onProgress);
}
