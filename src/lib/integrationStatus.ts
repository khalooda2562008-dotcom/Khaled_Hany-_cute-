import { hasOpfs } from './opfs';

export interface IntegrationStatus {
  key: string;
  name: string;
  active: boolean;
  note: string;
}

export interface CloudIntegrationFlags {
  r2: boolean;
  d1: boolean;
  turnstile: boolean;
  access: boolean;
}

/**
 * Single source of truth for the integrations panel.
 * Values are runtime checks (browser capability) or the Worker's /api/config
 * answer, never hard-coded promises.
 */
export function buildIntegrationStatus(cloud: CloudIntegrationFlags): IntegrationStatus[] {
  const webCodecs = typeof window !== 'undefined' && 'VideoDecoder' in window && 'VideoEncoder' in window;
  return [
    { key: 'ffmpeg', name: 'FFmpeg.wasm', active: true, note: 'محرك المونتاج والتصدير يعمل داخل المتصفح' },
    { key: 'webcodecs', name: 'WebCodecs', active: webCodecs, note: webCodecs ? 'تسريع اختياري متاح على هذا الجهاز' : 'غير مدعوم هنا؛ FFmpeg.wasm هو المسار الأساسي' },
    { key: 'indexeddb', name: 'IndexedDB', active: typeof indexedDB !== 'undefined', note: 'المشاريع والوسائط الأصلية على هذا الجهاز' },
    { key: 'opfs', name: 'OPFS', active: hasOpfs, note: hasOpfs ? 'نسخ التصدير محفوظة محليًا' : 'غير مدعوم في هذا المتصفح' },
    { key: 'wavesurfer', name: 'WaveSurfer.js', active: true, note: 'عرض الموجة الصوتية' },
    { key: 'lucide', name: 'Lucide', active: true, note: 'أيقونات الواجهة' },
    { key: 'pwa', name: 'Vite PWA', active: typeof navigator !== 'undefined' && 'serviceWorker' in navigator, note: 'تثبيت التطبيق والعمل دون اتصال' },
    { key: 'access', name: 'Cloudflare Access', active: cloud.access, note: cloud.access ? 'واجهة API محمية بتسجيل الدخول' : 'غير مهيأ على هذا النشر' },
    { key: 'r2', name: 'Cloudflare R2', active: cloud.r2, note: cloud.r2 ? 'نسخ احتياطي خاص ومتقطع' : 'غير مفعّل؛ التخزين محلي فقط' },
    { key: 'd1', name: 'Cloudflare D1', active: cloud.d1, note: cloud.d1 ? 'فهرس بيانات المشاريع' : 'غير مربوط' },
    { key: 'turnstile', name: 'Turnstile', active: cloud.turnstile, note: cloud.turnstile ? 'حماية نماذج الرفع' : 'غير مهيأ' },
  ];
}
