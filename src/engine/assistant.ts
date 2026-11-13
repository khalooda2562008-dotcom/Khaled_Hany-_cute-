import type { EditingPlan, EditingOperation } from '../types/editor';

/** Free deterministic intent parser. It never calls a paid model or executes model-generated shell commands. */
export function buildEditingPlan(request: string): EditingPlan {
  const text = request.toLowerCase();
  const operations: EditingOperation[] = [];
  if (/سكوت|صمت|سكتات|paus|silence|quiet/.test(text)) operations.push({ type: 'remove_silence', label: 'تحليل الصمت واقتراح قص الفواصل الطويلة', value: 1.1, supported: true });
  if (/نور|إضاءة|اضاء|سطوع|brightness|light/.test(text)) operations.push({ type: 'brightness', label: 'رفع الإضاءة بدرجة بسيطة', value: 0.12, supported: true });
  if (/صوت|ضوضاء|دوشة|تشويش|noise|voice|audio/.test(text)) operations.push({ type: 'noise_reduction', label: 'تقليل ضوضاء الصوت وتفعيل مرشح الترددات المنخفضة', supported: true });
  if (/سينمائ|cinematic|ألوان|الوان|color|colour/.test(text)) operations.push({ type: 'cinematic', label: 'تطبيق تدرج لوني سينمائي خفيف', supported: true });
  if (/ريلز|شورت|تيك.?توك|عمود|vertical|9:16/.test(text)) operations.push({ type: 'aspect_ratio', label: 'تغيير أبعاد المشروع إلى 9:16', value: '9:16', supported: true });
  if (/ديناميك|سريع|dynamic|faster/.test(text)) operations.push({ type: 'dynamic_cut', label: 'زيادة سرعة المقاطع إلى 1.05x', value: 1.05, supported: true });
  return { originalRequest: request, operations, requiresReview: true };
}
