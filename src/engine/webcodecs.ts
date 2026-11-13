export function canUseWebCodecs(): boolean {
  return typeof window !== 'undefined' && 'VideoDecoder' in window && 'VideoEncoder' in window;
}

export async function webCodecsSupportSummary(): Promise<string> {
  if (!canUseWebCodecs()) return 'WebCodecs غير مدعوم في هذا المتصفح؛ سيتم استخدام FFmpeg.wasm محلياً كبديل.';
  return 'WebCodecs مدعوم (تسريع اختياري عند توفر الترميز/الجهاز) مع إبقاء FFmpeg.wasm كمسار محلي موثوق.';
}
