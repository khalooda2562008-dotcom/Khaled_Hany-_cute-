import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

export function WaveformView({ url, peaks }: { url?: string; peaks?: number[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    wsRef.current?.destroy();
    if (!url) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 56,
      waveColor: '#4f8cff',
      progressColor: '#8ec5ff',
      cursorWidth: 0,
      interact: false,
      normalize: true,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      url,
    });
    wsRef.current = ws;
    return () => { ws.destroy(); wsRef.current = null; };
  }, [url]);

  if (!url) {
    return <div className="waveform" aria-label="موجة صوت">{peaks?.length ? peaks.map((height, index) => <i key={index} style={{ height: `${height}%` }} />) : <span className="waveform-pending">سيتم استخراج الموجة عند توفر الصوت</span>}</div>;
  }
  return <div ref={containerRef} className="waveform wavesurfer" aria-label="موجة صوت WaveSurfer.js" />;
}
