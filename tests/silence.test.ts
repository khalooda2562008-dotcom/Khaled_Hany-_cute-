import { describe, expect, it } from 'vitest';
import { logHasAudioStream, parseSilenceLog } from '../src/engine/silence';

const LOG = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'silence_scan.mp4':
  Duration: 00:00:12.00, start: 0.000000, bitrate: 900 kb/s
  Stream #0:0(und): Video: h264 (High), yuv420p, 1080x1920, 30 fps
  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s
[silencedetect @ 0x1] silence_start: 2.4
[silencedetect @ 0x1] silence_end: 4.1 | silence_duration: 1.7
[silencedetect @ 0x1] silence_start: 6
[silencedetect @ 0x1] silence_end: 6.4 | silence_duration: 0.4
[silencedetect @ 0x1] silence_start: 9.5
[silencedetect @ 0x1] silence_end: 12.2 | silence_duration: 2.7
`;

describe('silence detection log parsing', () => {
  it('keeps only ranges at least as long as the threshold', () => {
    const ranges = parseSilenceLog(LOG, 1.1);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ start: 2.4, end: 4.1 });
    expect(ranges[1]).toMatchObject({ start: 9.5, end: 12.2 });
  });

  it('lowers the threshold and keeps short pauses too', () => {
    expect(parseSilenceLog(LOG, 0.3)).toHaveLength(3);
  });

  it('clamps negative starts and drops ranges without an end', () => {
    const ranges = parseSilenceLog('silence_start: -0.5\nsilence_end: 1.2\nsilence_start: 5', 0.2);
    expect(ranges).toEqual([{ start: 0, end: 1.2, duration: 1.2 }]);
  });

  it('returns nothing when there is no silence at all', () => {
    expect(parseSilenceLog('frame= 120 fps=0.0 q=-0.0 size=N/A time=00:00:04.00', 1)).toEqual([]);
  });

  it('detects whether the input really has an audio stream', () => {
    expect(logHasAudioStream(LOG)).toBe(true);
    const videoOnly = 'Stream #0:0(und): Video: h264, yuv420p, 1080x1920';
    expect(logHasAudioStream(videoOnly)).toBe(false);
  });
});
