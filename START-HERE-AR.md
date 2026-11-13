# ابدأ من هنا — KHALED CUT AI

## ما الذي ستحصل عليه؟

هذا المستودع يحتوي على أساس عملي للمحرر: واجهة عربية متجاوبة، حفظ محلي للمشاريع والوسائط، معاينة فيديو، Timeline تسلسلي، قص وتقسيم وترتيب، تراجع/إعادة، تحليل صمت عبر FFmpeg.wasm، تحسين صوت وتصحيح ألوان أساسيين، وتصدير MP4 في المتصفحات والأجهزة التي تدعم الترميزات المطلوبة.

**مهم:** هذا إصدار تأسيسي قابل للتطوير، وليس بديلًا مكتملًا لكل وظائف Adobe Premiere. راجع `docs/FEATURES.md` قبل الاعتماد عليه؛ كل ميزة غير منفذة محددة بوضوح.

## التشغيل على الكمبيوتر

1. ثبّت Node.js 22 أو أحدث.
2. فك ضغط الملف وافتح المجلد في محرر الأكواد.
3. نفّذ:

```bash
npm install
npm run dev
```

4. افتح عنوان Vite الذي يظهر في الطرفية.
5. للاختبار على الهاتف والكمبيوتر على الشبكة نفسها، استخدم عنوان IP المحلي للكمبيوتر مع المنفذ `5173`.

## بناء النسخة النهائية

```bash
npm run typecheck
npm test
npm run build
```

ملفات النشر ستكون داخل `dist/`.

## رفعه إلى GitHub

- أنشئ مستودعًا جديدًا من: https://github.com/new
- ارفع **محتويات هذا المجلد** إلى المستودع، وليس ملف ZIP داخل المستودع.
- المستودع موصول بالمشروع (فرع `main`)، والكود يُرفع بعد موافقتك. ملف CI جاهز لكن رفعه يحتاج صلاحية `workflow` في حساب GitHub.
- البناء والنشر الموحّد: التطبيق والـ API على Cloudflare Workers مع Static Assets، لذا يوجد رابط واحد فقط.

## تشغيل Buddy

1. ارفع ZIP إلى Buddy أو افتح المجلد/المستودع الذي يحتوي على الملفات.
2. افتح `BUDDY-INTEGRATION-PROMPT.md`.
3. انسخ البرومبت كاملًا إلى Buddy.
4. اطلب منه أولًا فحص المشروع وحساب Cloudflare الموجود، وعدم حذف أو تغيير موارد سابقة.
5. لا توافق على أي خدمة مدفوعة أو إدخال بطاقة أو ترقية خطة. يجب أن يتوقف Buddy إذا لم يكن المسار مجانيًا فعلًا.
6. اطلب تقريرًا عن كل زر وميزة: تعمل، تعمل جزئيًا، أو غير منفذة، مع دليل اختبار حقيقي.

## الخدمات والروابط الرسمية

- GitHub: https://github.com/
- GitHub Docs: https://docs.github.com/
- Cloudflare Dashboard: https://dash.cloudflare.com/
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare Access: https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/
- FFmpeg.wasm: https://ffmpegwasm.netlify.app/
- FFmpeg filters: https://ffmpeg.org/ffmpeg-filters.html
- MDN Web APIs: https://developer.mozilla.org/en-US/docs/Web/API
- Vite: https://vite.dev/
- React: https://react.dev/

## التكلفة

المونتاج المحلي لا يحتاج اشتراك AI أو خادم تصيير مدفوع، لكن تنزيل FFmpeg.wasm لأول مرة يحتاج اتصال إنترنت. التخزين السحابي اختياري ويجب مراجعة حدود Cloudflare المجانية داخل الحساب قبل تشغيله؛ لا يمكن ضمان فاتورة صفرية إذا تجاوز الاستخدام الحصص المجانية أو احتاجت الحسابات ترقية.

## ملاحظات الاختبار

- راجعت ملفات TypeScript/TSX نحويًا باستخدام TypeScript transpilation: لا توجد أخطاء parsing في 13 ملفًا.
- لم أتمكن من تنزيل اعتماديات npm في بيئة الإنشاء الحالية، لذلك لم يتم تشغيل `npm install` أو `npm run build` أو Vitest هنا.
- لم أختبر التصدير على هاتف Android فعلي أو على فيديوهات مختلفة الترميز؛ يلزم تنفيذ اختبارات القبول قبل النشر العام.
