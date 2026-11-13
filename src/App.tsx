import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AudioLines, ArrowDown, ArrowLeft, ArrowUp, Check, Clapperboard,
  Cloud, Download, Film, FolderOpen, HardDrive, Layers, Maximize2, Menu,
  Mic2, MoreHorizontal, Pause, Play, Plus, Scissors, Settings2, ShieldCheck,
  SlidersHorizontal, Sparkles, Trash2, Undo2, Upload, WandSparkles, X, Redo2,
  Sun, MonitorPlay, RefreshCw, Save,
} from 'lucide-react';
import type { AudioSettings, ColorSettings, EditingPlan, MediaAsset, Panel, Project, TimelineClip } from './types/editor';
import { DEFAULT_AUDIO, DEFAULT_COLOR } from './types/editor';
import { database } from './store/database';
import { exportMp4 } from './engine/ffmpeg';
import { detectSilence } from './engine/silence';
import { extractWaveform } from './engine/waveform';
import { buildEditingPlan } from './engine/assistant';
import { cloudStorage, type CloudConfig, type CloudObject, type CloudUsage } from './services/cloudStorage';
import { WaveformView } from './components/WaveformView';
import { canUseWebCodecs } from './engine/webcodecs';
import { buildIntegrationStatus } from './lib/integrationStatus';
import { deleteOpfsExport, hasOpfs, listOpfsExports, loadOpfsExport, saveExportToOpfs, type OpfsExport } from './lib/opfs';
import { getTurnstileToken } from './services/turnstile';
import { clamp, formatBytes, formatTime, uid } from './utils/format';

const envCloudEnabled = import.meta.env.VITE_CLOUD_STORAGE_ENABLED === 'true';

function makeProject(name = 'مشروع جديد'): Project {
  const now = Date.now();
  return {
    id: uid('project'), name, createdAt: now, updatedAt: now, clips: [],
    color: { ...DEFAULT_COLOR }, audio: { ...DEFAULT_AUDIO }, aspectRatio: 'original', exportResolution: '1080p',
  };
}

async function inspectVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      const result = { duration: Number.isFinite(video.duration) ? video.duration : 0, width: video.videoWidth, height: video.videoHeight };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`تعذر قراءة بيانات الفيديو: ${file.name}`)); };
    video.src = url;
  });
}

function makeClip(asset: MediaAsset): TimelineClip {
  return { id: uid('clip'), mediaId: asset.id, name: asset.name, start: 0, end: asset.duration, sourceDuration: asset.duration, speed: 1, volume: 1, muted: false };
}

function clipOffsets(clips: TimelineClip[]) {
  let cursor = 0;
  return clips.map(clip => {
    const start = cursor;
    const duration = Math.max(0, (clip.end - clip.start) / Math.max(0.05, clip.speed));
    cursor += duration;
    return { clip, start, end: cursor, duration };
  });
}

const webCodecsAvailable = canUseWebCodecs();


function App() {

  const [panel, setPanel] = useState<Panel>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [mediaBlobs, setMediaBlobs] = useState<Map<string, Blob>>(new Map());
  const [mediaUrls, setMediaUrls] = useState<Map<string, string>>(new Map());
  const [waveformValues, setWaveformValues] = useState<number[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [status, setStatus] = useState('جاهز للمونتاج');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [plan, setPlan] = useState<EditingPlan | null>(null);
  const [silenceRanges, setSilenceRanges] = useState<Array<{ start: number; end: number; duration: number }>>([]);
  const [silenceThreshold, setSilenceThreshold] = useState(1.1);
  const [assistantText, setAssistantText] = useState('احذف السكوت الطويل ونضف الصوت وحسن الإضاءة بشكل طبيعي');
  const [exportResolution, setExportResolution] = useState<'720p' | '1080p' | 'source'>('1080p');
  const [storage, setStorage] = useState({ projects: 0, media: 0, bytes: 0 });
  const [cloudUsage, setCloudUsage] = useState<CloudUsage | null>(null);
  const [cloudObjects, setCloudObjects] = useState<CloudObject[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(envCloudEnabled);
  const [cloudConfig, setCloudConfig] = useState<CloudConfig | null>(null);
  const [cloudProgress, setCloudProgress] = useState<{ name: string; fraction: number } | null>(null);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('khaled-cut-export.mp4');
  const [opfsExports, setOpfsExports] = useState<OpfsExport[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const mediaUrlsRef = useRef<Map<string, string>>(new Map());
  const downloadUrlRef = useRef<string | null>(null);
  mediaUrlsRef.current = mediaUrls;
  downloadUrlRef.current = downloadUrl;

  const activeClip = project?.clips.find(c => c.id === selectedClipId) ?? project?.clips[0] ?? null;
  const integrationStatus = useMemo(() => buildIntegrationStatus({
    r2: Boolean(cloudConfig?.storageEnabled),
    d1: Boolean(cloudConfig?.d1Enabled),
    turnstile: Boolean(cloudConfig?.turnstileSiteKey),
    access: Boolean(cloudConfig?.accessEnabled),
  }), [cloudConfig]);
  const offsets = useMemo(() => clipOffsets(project?.clips ?? []), [project?.clips]);
  const totalDuration = offsets.at(-1)?.end ?? 0;
  const activeEntry = offsets.find(entry => entry.clip.id === activeClip?.id);
  const activeAsset = activeClip ? media.find(item => item.id === activeClip.mediaId) : undefined;
  const videoSrc = activeClip ? mediaUrls.get(activeClip.mediaId) : undefined;
  const selectedLocalTime = activeEntry && activeClip ? activeClip.start + (currentTime - activeEntry.start) * activeClip.speed : 0;
  const displayTime = clamp(currentTime, 0, Math.max(0, totalDuration));

  const refreshStorage = useCallback(async () => {
    try { setStorage(await database.estimate()); } catch { /* Browser storage may be unavailable in private mode. */ }
  }, []);

  const refreshOpfsExports = useCallback(async () => {
    setOpfsExports(await listOpfsExports());
  }, []);

  useEffect(() => {
    if (panel === 'storage') void refreshOpfsExports();
  }, [panel, refreshOpfsExports]);

  useEffect(() => {
    let active = true;
    cloudStorage.config()
      .then(config => { if (active) { setCloudConfig(config); if (config.storageEnabled) setCloudEnabled(true); } })
      .catch(() => { /* Local-only mode when the optional API is not deployed. */ });
    return () => { active = false; };
  }, []);

  const refreshCloud = useCallback(async () => {
    if (!cloudEnabled) return;
    try {
      const [usage, listing] = await Promise.all([cloudStorage.usage(), cloudStorage.list()]);
      setCloudUsage(usage); setCloudObjects(listing.objects);
    } catch (e) { setError(`تعذر الاتصال بتخزين R2: ${(e as Error).message}`); }
  }, []);

  const uploadMediaToCloud = async (asset: MediaAsset) => {
    const blob = mediaBlobs.get(asset.id);
    if (!blob) { setError('الملف المحلي غير موجود.'); return; }
    setCloudBusy(true); setError('');
    try {
      const file = new File([blob], asset.name, { type: asset.mime });
      const token = await getTurnstileToken(cloudConfig?.turnstileSiteKey);
      setCloudProgress({ name: asset.name, fraction: 0 });
      const result = await cloudStorage.upload(file, {
        turnstileToken: token,
        onProgress: fraction => setCloudProgress({ name: asset.name, fraction }),
      });
      await refreshCloud();
      setStatus(`تم رفع نسخة إلى Cloudflare R2 (${formatBytes(result.size)})${result.resumed ? ' باستئناف الرفع السابق' : ''}؛ الأصل المحلي لم يتغير.`);
    } catch (e) { setError(`فشل الرفع السحابي: ${(e as Error).message}`); }
    finally { setCloudBusy(false); setCloudProgress(null); }
  };

  const deleteCloudMedia = async (key: string) => {
    if (!confirm('هل تريد حذف هذه النسخة من R2؟')) return;
    setCloudBusy(true);
    try { await cloudStorage.remove(key); await refreshCloud(); setStatus('تم حذف النسخة السحابية.'); }
    catch (e) { setError(`تعذر الحذف: ${(e as Error).message}`); }
    finally { setCloudBusy(false); }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [savedProjects, savedMedia] = await Promise.all([database.getProjects(), database.getAllMedia()]);
        if (!active) return;
        const sorted = savedProjects.sort((a, b) => b.updatedAt - a.updatedAt);
        setProjects(sorted);
        setMedia(savedMedia.map(({ blob: _blob, ...asset }) => asset));
        setMediaBlobs(new Map(savedMedia.map(item => [item.id, item.blob])));
        setMediaUrls(new Map(savedMedia.map(item => [item.id, URL.createObjectURL(item.blob)])));
        if (sorted[0]) { setProject(sorted[0]); setPanel('editor'); }
        await refreshStorage();
      } catch (e) { setError(`تعذر فتح التخزين المحلي: ${(e as Error).message}`); }
    })();
    return () => { active = false; };
  }, [refreshStorage]);

  useEffect(() => () => { mediaUrlsRef.current.forEach(url => URL.revokeObjectURL(url)); if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current); }, []);

  useEffect(() => {
    let mounted = true;
    const blob = activeClip ? mediaBlobs.get(activeClip.mediaId) : undefined;
    setWaveformValues([]);
    if (blob) extractWaveform(blob).then(values => { if (mounted) setWaveformValues(values); }).catch(() => { if (mounted) setWaveformValues([]); });
    return () => { mounted = false; };
  }, [activeClip?.mediaId, activeClip ? mediaBlobs.get(activeClip.mediaId) : undefined]);

  useEffect(() => {
    if (!project) return;
    const updated = { ...project, updatedAt: Date.now() };
    const timer = window.setTimeout(() => {
      database.saveProject(updated).then(refreshStorage).catch(e => setError(`تعذر حفظ المشروع: ${(e as Error).message}`));
      setProjects(current => [updated, ...current.filter(p => p.id !== updated.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [project, refreshStorage]);

  useEffect(() => {
    if (!videoRef.current || !videoSrc || !activeClip) return;
    const video = videoRef.current;
    if (video.src !== videoSrc) video.src = videoSrc;
    const seek = () => {
      const target = clamp(selectedLocalTime, activeClip.start, Math.max(activeClip.start, activeClip.end - 0.02));
      if (Math.abs(video.currentTime - target) > 0.35) video.currentTime = target;
      video.playbackRate = activeClip.speed;
      video.volume = activeClip.muted ? 0 : clamp(activeClip.volume * (project?.audio.gain ?? 1), 0, 1);
    };
    if (video.readyState >= 1) seek(); else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [videoSrc, activeClip?.id, activeClip?.start, activeClip?.end, activeClip?.speed, selectedLocalTime, activeClip?.volume, activeClip?.muted, project?.audio.gain]);

  useEffect(() => {
    if (!playing || !activeClip || !activeEntry || !videoRef.current) return;
    const video = videoRef.current;
    const onTime = () => {
      const t = activeEntry.start + (video.currentTime - activeClip.start) / Math.max(0.05, activeClip.speed);
      setCurrentTime(t);
      if (video.currentTime >= activeClip.end - 0.04) {
        const next = offsets.find(entry => entry.start >= activeEntry.end - 0.02);
        if (next) {
          setSelectedClipId(next.clip.id);
          setCurrentTime(next.start);
        } else {
          video.pause(); setPlaying(false); setCurrentTime(totalDuration);
        }
      }
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [playing, activeClip, activeEntry, offsets, totalDuration]);

  const commit = useCallback((next: Project) => {
    if (project) setHistory(stack => [...stack.slice(-39), project]);
    setFuture([]);
    setProject({ ...next, updatedAt: Date.now() });
  }, [project]);

  const updateProject = useCallback((updater: (current: Project) => Project) => {
    if (!project) return;
    commit(updater(project));
  }, [project, commit]);

  const undo = () => {
    if (!project || history.length === 0) return;
    const previous = history[history.length - 1];
    setFuture(stack => [...stack, project]); setHistory(stack => stack.slice(0, -1)); setProject(previous); setStatus('تم التراجع عن آخر تعديل');
  };
  const redo = () => {
    if (!project || future.length === 0) return;
    const next = future[future.length - 1];
    setHistory(stack => [...stack, project]); setFuture(stack => stack.slice(0, -1)); setProject(next); setStatus('تمت إعادة التعديل');
  };

  const createProject = () => {
    const next = makeProject(`مشروع ${projects.length + 1}`);
    setProject(next); setProjects(current => [next, ...current]); setSelectedClipId(null); setCurrentTime(0); setPanel('editor'); setHistory([]); setFuture([]); setStatus('تم إنشاء مشروع جديد');
  };

  const duplicateCurrentProject = () => {
    if (!project) { setError('افتح مشروعًا أولًا لنسخه.'); return; }
    const now = Date.now();
    const copy: Project = {
      ...project,
      id: uid('project'),
      name: `${project.name} — نسخة`,
      createdAt: now,
      updatedAt: now,
      clips: project.clips.map(clip => ({ ...clip, id: uid('clip') })),
    };
    setProjects(current => [copy, ...current]);
    setProject(copy);
    setSelectedClipId(copy.clips[0]?.id ?? null);
    setCurrentTime(0);
    setHistory([]);
    setFuture([]);
    setPanel('editor');
    setStatus('تم إنشاء نسخة مستقلة من المشروع');
  };

  const deleteCurrentProject = async () => {
    if (!project) { setError('لا يوجد مشروع مفتوح لحذفه.'); return; }
    if (!confirm(`هل تريد حذف المشروع «${project.name}»؟ ملفات الفيديو الأصلية ستظل في مكتبة الوسائط.`)) return;
    try {
      await database.deleteProject(project.id);
      const remaining = projects.filter(item => item.id !== project.id);
      setProjects(remaining);
      setProject(remaining[0] ?? null);
      setSelectedClipId(remaining[0]?.clips[0]?.id ?? null);
      setCurrentTime(0);
      setPlaying(false);
      setHistory([]);
      setFuture([]);
      setPanel(remaining.length ? 'editor' : 'projects');
      setStatus('تم حذف المشروع فقط؛ ملفات الفيديو الأصلية لم تُحذف.');
    } catch (e) { setError(`تعذر حذف المشروع: ${(e as Error).message}`); }
  };

  const openProject = async (item: Project) => {
    setProject(item); setPanel('editor'); setHistory([]); setFuture([]); setSelectedClipId(item.clips[0]?.id ?? null); setCurrentTime(0); setPlaying(false); setStatus('تم فتح المشروع');
  };

  const importFiles = async (files: FileList | File[]) => {
    if (!files.length) return;
    setBusy(true); setError(''); setProgress(0); setProgressLabel('جاري فحص الملفات...');
    try {
      const newAssets: MediaAsset[] = [];
      const newBlobs = new Map(mediaBlobs);
      const newUrls = new Map(mediaUrls);
      for (const [index, file] of Array.from(files).entries()) {
        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        const inferredMime: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm' };
        const effectiveMime = file.type.startsWith('video/') ? file.type : (inferredMime[extension] || file.type);
        if (!effectiveMime.startsWith('video/')) {
          if (effectiveMime.startsWith('audio/')) { setStatus(`تم تجاهل الملف الصوتي مؤقتًا: ${file.name} — استيراد مسارات الصوت المنفصلة غير متاح في هذا الإصدار`); continue; }
          throw new Error(`نوع الملف غير مدعوم حاليًا: ${file.name}`);
        }
        const meta = await inspectVideo(file);
        if (!meta.duration || !meta.width || !meta.height) throw new Error(`تعذر قراءة خصائص الفيديو: ${file.name}`);
        const asset: MediaAsset = { id: uid('media'), name: file.name, mime: effectiveMime, size: file.size, duration: meta.duration, width: meta.width, height: meta.height, hasAudio: true, createdAt: Date.now() };
        await database.saveMedia(asset, file);
        newAssets.push(asset); newBlobs.set(asset.id, file); newUrls.set(asset.id, URL.createObjectURL(file));
        setProgress(Math.round(((index + 1) / files.length) * 100));
      }
      setMedia(current => [...newAssets, ...current]); setMediaBlobs(newBlobs); setMediaUrls(newUrls);
      if (!project && newAssets.length) {
        const next = makeProject('مشروعي الأول');
        next.clips = newAssets.map(makeClip);
        setProject(next); setProjects(current => [next, ...current]); setSelectedClipId(next.clips[0]?.id ?? null); setPanel('editor');
      } else if (project && newAssets.length) {
        const clips = newAssets.map(makeClip);
        const next = { ...project, clips: [...project.clips, ...clips] };
        commit(next); if (!selectedClipId) setSelectedClipId(clips[0].id); setPanel('editor');
      }
      setStatus(newAssets.length ? `تم استيراد ${newAssets.length} ملف بنجاح` : 'لم يتم استيراد فيديو؛ استيراد ملفات الصوت المنفصلة غير متاح حاليًا'); await refreshStorage();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setProgress(0); setProgressLabel(''); }
  };

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
    const onDragEnter = (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); setIsDragging(true); } };
    const onDragLeave = (event: DragEvent) => { if (hasFiles(event) && (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight)) setIsDragging(false); };
    const onDrop = (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); setIsDragging(false); if (event.dataTransfer?.files.length) importFiles(event.dataTransfer.files); } };
    window.addEventListener('dragover', onDragOver); window.addEventListener('dragenter', onDragEnter); window.addEventListener('dragleave', onDragLeave); window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragover', onDragOver); window.removeEventListener('dragenter', onDragEnter); window.removeEventListener('dragleave', onDragLeave); window.removeEventListener('drop', onDrop); };
  }, [importFiles]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    if (playing) {
      video.pause();
      setPlaying(false);
    } else {
      video.play().then(() => setPlaying(true)).catch(() => setError('تعذر تشغيل الفيديو في المتصفح.'));
    }
  };

  const removeSelected = () => {
    if (!project || !activeClip) return;
    const index = project.clips.findIndex(c => c.id === activeClip.id);
    const nextClips = project.clips.filter(c => c.id !== activeClip.id);
    commit({ ...project, clips: nextClips });
    setSelectedClipId(nextClips[Math.min(index, nextClips.length - 1)]?.id ?? null);
    setCurrentTime(0); setStatus('تم حذف المقطع من الخط الزمني — الملف الأصلي محفوظ');
  };

  const moveSelected = (direction: -1 | 1) => {
    if (!project || !activeClip) return;
    const index = project.clips.findIndex(c => c.id === activeClip.id);
    const target = index + direction;
    if (target < 0 || target >= project.clips.length) return;
    const clips = [...project.clips]; [clips[index], clips[target]] = [clips[target], clips[index]];
    commit({ ...project, clips }); setStatus('تم تغيير ترتيب المقطع');
  };

  const splitSelected = () => {
    if (!project || !activeClip || !activeEntry) return;
    const sourceAt = activeClip.start + (displayTime - activeEntry.start) * activeClip.speed;
    if (sourceAt <= activeClip.start + 0.08 || sourceAt >= activeClip.end - 0.08) { setError('حرّك مؤشر التشغيل إلى داخل المقطع قبل التقسيم.'); return; }
    const index = project.clips.findIndex(c => c.id === activeClip.id);
    const first = { ...activeClip, id: uid('clip'), end: sourceAt };
    const second = { ...activeClip, id: uid('clip'), start: sourceAt, name: `${activeClip.name} — 2` };
    const clips = [...project.clips]; clips.splice(index, 1, first, second);
    commit({ ...project, clips }); setSelectedClipId(second.id); setStatus('تم تقسيم المقطع عند مؤشر التشغيل');
  };

  const runSilenceDetection = async () => {
    if (!activeClip || !mediaBlobs.get(activeClip.mediaId)) { setError('اختر مقطع فيديو أولًا.'); return; }
    setBusy(true); setError(''); setStatus('يتم تحليل الصوت محليًا باستخدام FFmpeg...'); setProgressLabel('تحليل الصمت...');
    try {
      const ranges = await detectSilence(mediaBlobs.get(activeClip.mediaId)!, -35, silenceThreshold);
      const relevant = ranges.filter(r => r.end > activeClip.start && r.start < activeClip.end);
      setSilenceRanges(relevant); setStatus(relevant.length ? `تم العثور على ${relevant.length} فواصل صمت مرشحة` : 'لم يتم العثور على فواصل صمت تطابق الإعدادات');
    } catch (e) { setError(`فشل تحليل الصمت: ${(e as Error).message}`); }
    finally { setBusy(false); setProgressLabel(''); }
  };

  const applySilenceCuts = () => {
    if (!project || !activeClip || !silenceRanges.length) return;
    const pad = 0.18;
    const cuts = silenceRanges.filter(r => r.duration >= silenceThreshold).map(r => ({ start: Math.max(activeClip.start, r.start + pad), end: Math.min(activeClip.end, r.end - pad) })).filter(r => r.end > r.start);
    const segments: TimelineClip[] = [];
    let cursor = activeClip.start;
    for (const cut of cuts) {
      if (cut.start - cursor >= 0.12) segments.push({ ...activeClip, id: uid('clip'), start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
    }
    if (activeClip.end - cursor >= 0.12) segments.push({ ...activeClip, id: uid('clip'), start: cursor, end: activeClip.end });
    if (!segments.length) { setError('لم ينتج عن اقتراح القص أي مقاطع آمنة؛ لم يتم تغيير الفيديو.'); return; }
    const index = project.clips.findIndex(c => c.id === activeClip.id);
    const clips = [...project.clips]; clips.splice(index, 1, ...segments);
    commit({ ...project, clips }); setSelectedClipId(segments[0].id); setSilenceRanges([]); setStatus(`تمت إزالة ${cuts.length} فواصل صمت مع ترك هامش لحماية الكلام`);
  };

  const addAssetToTimeline = (asset: MediaAsset) => {
    const clip = makeClip(asset);
    if (!project) {
      const next = makeProject('مشروع من الوسائط');
      next.clips = [clip];
      setProject(next);
      setProjects(current => [next, ...current.filter(item => item.id !== next.id)]);
      setSelectedClipId(clip.id);
      setCurrentTime(0);
      setHistory([]);
      setFuture([]);
    } else {
      const next = { ...project, clips: [...project.clips, clip] };
      commit(next);
      setSelectedClipId(clip.id);
    }
    setPanel('editor');
    setStatus(`تمت إضافة ${asset.name} إلى الخط الزمني`);
  };

  const createPlan = () => {
    const next = buildEditingPlan(assistantText.trim());
    setPlan(next);
    if (!next.operations.length) setStatus('لم أتعرف على إجراء مدعوم في الطلب. جرّب صياغة أبسط مثل: احذف السكوت وحسن الصوت.');
  };

  const applyPlan = async () => {
    if (!plan || !project) return;
    const operations = plan.operations;
    let next = { ...project };
    for (const operation of operations) {
      if (operation.type === 'brightness') next.color = { ...next.color, brightness: clamp(next.color.brightness + Number(operation.value ?? 0.1), -1, 1) };
      if (operation.type === 'noise_reduction') next.audio = { ...next.audio, noiseReduction: true, highpass: true, normalize: true };
      if (operation.type === 'cinematic') next.color = { ...next.color, contrast: 1.08, saturation: 1.12, brightness: 0.025 };
      if (operation.type === 'aspect_ratio') next.aspectRatio = '9:16';
      if (operation.type === 'dynamic_cut') next.clips = next.clips.map(c => ({ ...c, speed: Math.min(1.5, Math.max(c.speed, Number(operation.value ?? 1.05))) }));
    }
    commit(next); setPlan(null); setPanel('editor'); setStatus('تم تطبيق الإعدادات المدعومة على المشروع');
    if (operations.some(op => op.type === 'remove_silence')) { await runSilenceDetection(); setPanel('audio'); }
  };

  const startExport = async () => {
    if (!project || !project.clips.length) { setError('أضف فيديو إلى الخط الزمني قبل التصدير.'); return; }
    setBusy(true); setPlaying(false); setError(''); setProgress(0); setProgressLabel('تهيئة محرك FFmpeg.wasm...');
    try {
      const blobs = new Map<string, Blob>();
      project.clips.forEach(clip => { const blob = mediaBlobs.get(clip.mediaId); if (blob) blobs.set(clip.mediaId, blob); });
      const output = await exportMp4({ clips: project.clips, media: blobs, sourceWidth: media.find(m => m.id === project.clips[0].mediaId)?.width, sourceHeight: media.find(m => m.id === project.clips[0].mediaId)?.height, color: project.color, audio: project.audio, resolution: exportResolution, aspectRatio: project.aspectRatio, onProgress: (fraction, message) => { setProgress(Math.round(fraction * 100)); setProgressLabel(message); } });
      const url = URL.createObjectURL(output);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      const exportName = `${project.name.replace(/[\\/:*?"<>|]/g, '-')}-KHALED-CUT.mp4`;
      setDownloadUrl(url); setDownloadName(exportName);
      const cachedToOpfs = await saveExportToOpfs(exportName, output);
      if (cachedToOpfs) await refreshOpfsExports();
      setStatus(`اكتمل ملف MP4 حقيقي بحجم ${formatBytes(output.size)}${cachedToOpfs ? ' · نسخة محفوظة في OPFS' : ''}`);
    } catch (e) { setError(`لم يكتمل التصدير: ${(e as Error).message}`); }
    finally { setBusy(false); setProgressLabel(''); }
  };

  const downloadExport = () => {
    if (!downloadUrl) return;
    const a = document.createElement('a'); a.href = downloadUrl; a.download = downloadName; document.body.appendChild(a); a.click(); a.remove();
  };

  const downloadOpfsExport = async (name: string) => {
    const blob = await loadOpfsExport(name);
    if (!blob) { setError('تعذر قراءة النسخة المحفوظة من OPFS.'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const removeOpfsExport = async (name: string) => {
    if (!(await deleteOpfsExport(name))) { setError('تعذر حذف الملف من OPFS.'); return; }
    await refreshOpfsExports();
    setStatus(`تم حذف ${name} من تخزين OPFS`);
  };

  const updateClip = (patch: Partial<TimelineClip>) => {
    if (!project || !activeClip) return;
    commit({ ...project, clips: project.clips.map(c => c.id === activeClip.id ? { ...c, ...patch } : c) });
  };
  const updateColor = (patch: Partial<ColorSettings>) => updateProject(p => ({ ...p, color: { ...p.color, ...patch } }));
  const updateAudio = (patch: Partial<AudioSettings>) => updateProject(p => ({ ...p, audio: { ...p.audio, ...patch } }));

  const seekTo = (seconds: number) => {
    const target = clamp(seconds, 0, totalDuration);
    const entry = offsets.find(x => target >= x.start && target < x.end) ?? offsets.at(-1);
    if (!entry) return;
    setSelectedClipId(entry.clip.id); setCurrentTime(target);
    if (videoRef.current) videoRef.current.currentTime = entry.clip.start + (target - entry.start) * entry.clip.speed;
  };

  const setNav = (key: Panel) => { setPanel(key); setShowMobileMenu(false); };
  const nav = [
    { key: 'projects' as const, label: 'المشاريع', icon: FolderOpen },
    { key: 'editor' as const, label: 'المحرر', icon: Clapperboard },
    { key: 'media' as const, label: 'الوسائط', icon: Film },
    { key: 'audio' as const, label: 'الصوت', icon: AudioLines },
    { key: 'color' as const, label: 'الألوان', icon: Sun },
    { key: 'assistant' as const, label: 'مساعد AI', icon: Sparkles },
    { key: 'storage' as const, label: 'التخزين', icon: HardDrive },
    { key: 'settings' as const, label: 'الإعدادات', icon: Settings2 },
  ];

  return (
    <div className="app-shell rtl" dir="rtl">
      <aside className={`sidebar ${showMobileMenu ? 'open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span>K</span><i /></div>
          <div><strong>KHALED CUT <em>AI</em></strong><small>SMART VIDEO STUDIO</small></div>
          <button className="icon-button sidebar-close" onClick={() => setShowMobileMenu(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <button className="new-project" onClick={createProject}><Plus size={17} /><span>مشروع جديد</span></button>
        <div className="nav-caption">مساحة العمل</div>
        <nav className="side-nav">
          {nav.map(item => <button key={item.key} className={`nav-item ${panel === item.key ? 'active' : ''}`} onClick={() => setNav(item.key)}><item.icon size={18} /><span>{item.label}</span>{item.key === 'assistant' && <b className="new-dot" />}</button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="local-status"><div className="status-light" /><div><strong>معالجة محلية</strong><small>ملفاتك على جهازك</small></div><ShieldCheck size={18} /></div>
        <div className="sidebar-footer"><span>الإصدار 1.0.0</span><span>© KHALED CUT</span></div>
      </aside>
      {showMobileMenu && <button className="mobile-scrim" onClick={() => setShowMobileMenu(false)} aria-label="إغلاق القائمة" />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-start">
            <button className="icon-button mobile-menu-button" onClick={() => setShowMobileMenu(true)} aria-label="القائمة"><Menu size={20} /></button>
            <div className="breadcrumb"><span>KHALED CUT</span><i>/</i><strong>{nav.find(item => item.key === panel)?.label ?? 'المحرر'}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="save-indicator"><span /> الحفظ التلقائي يعمل</div>
            <button className="export-button" onClick={startExport} disabled={!project?.clips.length || busy}><Download size={16} /><span>تصدير الفيديو</span></button>
          </div>
        </header>

        {error && <div className="toast error-toast"><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
        {status && <div className="status-line"><span className="status-pulse" />{status}</div>}

        {busy && <div className="task-progress"><div className="task-progress-top"><span>{progressLabel || 'جارٍ التنفيذ...'}</span><strong>{progress}%</strong></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div>}

        {panel === 'projects' && (
          <section className="page-content dashboard-page">
            <div className="page-heading"><div><div className="eyebrow">YOUR CREATIVE WORKSPACE</div><h1>استوديو مشاريعك</h1><p>ابدأ مشروعًا جديدًا أو أكمل المونتاج من آخر نقطة.</p></div><button className="primary-button" onClick={createProject}><Plus size={17} /> إنشاء مشروع</button></div>
            <div className="stats-grid"><div className="stat-card"><div className="stat-icon violet"><FolderOpen size={19} /></div><small>إجمالي المشاريع</small><strong>{projects.length}</strong></div><div className="stat-card"><div className="stat-icon cyan"><Film size={19} /></div><small>ملفات الوسائط</small><strong>{media.length}</strong></div><div className="stat-card"><div className="stat-icon green"><HardDrive size={19} /></div><small>حجم التخزين المحلي</small><strong>{formatBytes(storage.bytes)}</strong></div></div>
            <div className="section-title"><div><h2>المشاريع الأخيرة</h2><p>تُحفظ التعديلات تلقائيًا على هذا الجهاز</p></div><span className="count-pill">{projects.length} مشروع</span></div>
            {projects.length === 0 ? <div className="empty-state"><div className="empty-icon"><Clapperboard size={34} /></div><h3>مساحة عملك جاهزة</h3><p>أنشئ مشروعك الأول أو استورد فيديو وابدأ المونتاج.</p><div className="empty-actions"><button className="primary-button" onClick={createProject}><Plus size={16} /> مشروع جديد</button><button className="secondary-button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> استيراد فيديو</button></div></div> : <div className="project-grid">{projects.map(item => <button className="project-card" key={item.id} onClick={() => openProject(item)}><div className="project-thumb"><div className="thumb-gradient"><Clapperboard size={29} /></div><span>{formatTime(item.clips.reduce((s, c) => s + (c.end - c.start) / c.speed, 0))}</span></div><div className="project-meta"><strong>{item.name}</strong><small>{item.clips.length} مقطع · {new Date(item.updatedAt).toLocaleDateString('ar-EG')}</small></div><MoreHorizontal size={18} className="project-more" /></button>)}</div>}
          </section>
        )}

        {panel === 'editor' && (
          <section className="editor-page">
            <div className="editor-titlebar"><div><input aria-label="اسم المشروع" value={project?.name ?? ''} placeholder="اسم المشروع" onChange={e => project && setProject({ ...project, name: e.target.value })} /><span className="project-saved"><Save size={12} /> حفظ تلقائي</span></div><div className="editor-title-actions"><button className="icon-button" title="تراجع" disabled={!history.length} onClick={undo}><Undo2 size={18} /></button><button className="icon-button" title="إعادة" disabled={!future.length} onClick={redo}><Redo2 size={18} /></button><button className="secondary-button compact" onClick={() => fileInputRef.current?.click()}><Plus size={15} /> إضافة وسائط</button></div></div>
            {!project?.clips.length ? <div className="editor-empty"><div className="upload-orb"><Upload size={29} /></div><h2>ابدأ مشروعك بإضافة فيديو</h2><p>استورد مقطعًا من الهاتف أو الكمبيوتر. تتم المعالجة على جهازك.</p><button className="primary-button" onClick={() => fileInputRef.current?.click()}><Upload size={17} /> اختيار فيديو</button><small>MP4 · MOV · WEBM حسب دعم المتصفح والترميز</small></div> : <>
              <div className="studio-workspace">
                <div className="preview-column">
                  <div className="preview-toolbar"><span><MonitorPlay size={15} /> شاشة المعاينة</span><div><span className="preview-resolution">{activeAsset ? `${activeAsset.width}×${activeAsset.height}` : '—'}</span><button className="icon-button tiny" title="ملء الشاشة" onClick={() => videoRef.current?.requestFullscreen?.()}><Maximize2 size={15} /></button></div></div>
                  <div className={`preview-frame ratio-${project?.aspectRatio.replace(':', '-') ?? 'original'}`}>
                    {videoSrc ? <video ref={videoRef} src={videoSrc} playsInline controls={false} onClick={togglePlayback} style={{ filter: `brightness(${1 + project.color.brightness + project.color.exposure}) contrast(${project.color.contrast}) saturate(${project.color.saturation})` }} /> : <div className="preview-placeholder"><Film size={38} /><span>معاينة الفيديو</span></div>}
                    {!videoSrc && <div className="preview-placeholder"><Film size={38} /><span>اختر مقطعًا من الخط الزمني</span></div>}
                  </div>
                  <div className="preview-controls"><button className="play-button" disabled={!activeClip} onClick={togglePlayback}>{playing ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</button><span className="timecode">{formatTime(displayTime)} <i>/</i> {formatTime(totalDuration)}</span><input type="range" min="0" max={Math.max(totalDuration, 0.01)} step="0.01" value={displayTime} onChange={e => seekTo(Number(e.target.value))} aria-label="موقع التشغيل" /><span className="preview-zoom">100%</span></div>
                </div>
                <aside className="inspector-panel">
                  <div className="inspector-head"><div><span className="eyebrow">CLIP INSPECTOR</span><h3>خصائص المقطع</h3></div><Settings2 size={18} /></div>
                  {activeClip ? <>
                    <div className="selected-media"><div className="selected-media-icon"><Film size={19} /></div><div><strong>{activeClip.name}</strong><small>{formatTime(activeClip.end - activeClip.start)} · سرعة {activeClip.speed}x</small></div></div>
                    <div className="control-group"><div className="control-label"><label>بداية القص</label><strong>{formatTime(activeClip.start)}</strong></div><input type="range" min="0" max={Math.max(0, activeClip.end - 0.1)} step="0.05" value={activeClip.start} onChange={e => updateClip({ start: Math.min(Number(e.target.value), activeClip.end - 0.1) })} /></div>
                    <div className="control-group"><div className="control-label"><label>نهاية القص</label><strong>{formatTime(activeClip.end)}</strong></div><input type="range" min={Math.min(activeClip.start + 0.1, activeClip.sourceDuration)} max={activeClip.sourceDuration} step="0.05" value={activeClip.end} onChange={e => updateClip({ end: Math.max(Number(e.target.value), activeClip.start + 0.1) })} /></div>
                    <div className="control-group"><div className="control-label"><label>سرعة المقطع</label><strong>{activeClip.speed.toFixed(2)}x</strong></div><input type="range" min="0.25" max="2" step="0.05" value={activeClip.speed} onChange={e => updateClip({ speed: Number(e.target.value) })} /></div>
                    <div className="control-group"><div className="control-label"><label>مستوى صوت المقطع</label><strong>{Math.round(activeClip.volume * 100)}%</strong></div><input type="range" min="0" max="2" step="0.05" value={activeClip.volume} onChange={e => updateClip({ volume: Number(e.target.value) })} /></div>
                    <div className="inspector-actions"><button className="secondary-button compact" onClick={splitSelected}><Scissors size={14} /> تقسيم</button><button className="icon-button danger" title="حذف من الخط الزمني" onClick={removeSelected}><Trash2 size={16} /></button></div>
                  </> : <div className="inspector-empty">اختر مقطعًا من الخط الزمني لعرض خصائصه.</div>}
                </aside>
              </div>
              <section className="timeline-panel" ref={timelineRef}>
                <div className="timeline-header"><div><Layers size={17} /><strong>الخط الزمني</strong><span>{project.clips.length} مقطع</span></div><div className="timeline-actions"><button className="icon-button tiny" title="تحريك لأعلى" onClick={() => moveSelected(-1)}><ArrowUp size={15} /></button><button className="icon-button tiny" title="تحريك لأسفل" onClick={() => moveSelected(1)}><ArrowDown size={15} /></button><button className="icon-button tiny" title="تقسيم" onClick={splitSelected}><Scissors size={15} /></button><button className="icon-button tiny danger" title="حذف" onClick={removeSelected}><Trash2 size={15} /></button><button className="icon-button tiny" title="إضافة فيديو" onClick={() => fileInputRef.current?.click()}><Plus size={16} /></button></div></div>
                <div className="timeline-ruler"><span>00:00</span><span>{formatTime(totalDuration * 0.25)}</span><span>{formatTime(totalDuration * 0.5)}</span><span>{formatTime(totalDuration * 0.75)}</span><span>{formatTime(totalDuration)}</span></div>
                <div className="timeline-track-area">
                  <div className="track-label">V1</div>
                  <div className="track-clips">
                    {offsets.map(({ clip, start, duration }) => <button key={clip.id} className={`timeline-clip ${selectedClipId === clip.id ? 'selected' : ''}`} style={{ width: `${Math.max(10, duration / Math.max(totalDuration, 1) * 100)}%` }} onClick={() => { setSelectedClipId(clip.id); seekTo(start); }}><span className="clip-filmstrip"><i /><i /><i /><i /></span><strong>{clip.name}</strong><small>{formatTime(duration)}</small></button>)}
                    <div className="playhead" style={{ right: `${totalDuration ? (displayTime / totalDuration) * 100 : 0}%` }} />
                  </div>
                  <div className="track-label audio-label">A1</div>
                  <div className="track-audio">{project.clips.length > 0 ? <><WaveformView url={videoSrc} peaks={waveformValues} /><span>صوت الفيديو الأصلي</span></> : <span>لا يوجد مسار صوتي</span>}</div>
                </div>
                <div className="timeline-footer"><span>اسحب المؤشر لمراجعة المقطع</span><span><Activity size={13} /> {formatTime(totalDuration)} إجمالي</span></div>
              </section>
              <div className="quick-tools"><button onClick={() => setNav('assistant')}><Sparkles size={17} /><span>تحرير تلقائي بالذكاء الاصطناعي</span><b>AI</b></button><button onClick={() => setNav('audio')}><AudioLines size={17} /><span>تنظيف الصوت</span></button><button onClick={() => setNav('color')}><Sun size={17} /><span>تصحيح الألوان</span></button></div>
            </>}
          </section>
        )}

        {panel === 'media' && (
          <section className="page-content">
            <div className="page-heading"><div><div className="eyebrow">MEDIA LIBRARY</div><h1>مكتبة الوسائط</h1><p>ملفات الفيديو المستوردة محفوظة محليًا في مساحة تخزين المتصفح.</p></div><button className="primary-button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> استيراد ملفات</button></div>
            <div className="media-summary"><span><Film size={16} /> {media.length} ملف فيديو</span><span><HardDrive size={16} /> {formatBytes(storage.bytes)} مستخدم</span></div>
            {media.length ? <div className="media-grid">{media.map(asset => <div className="media-card" key={asset.id}><div className="media-preview">{mediaUrls.get(asset.id) ? <video src={mediaUrls.get(asset.id)} muted preload="metadata" /> : <Film size={28} />}<span>{formatTime(asset.duration)}</span></div><div className="media-card-body"><strong title={asset.name}>{asset.name}</strong><small>{asset.width}×{asset.height} · {formatBytes(asset.size)}</small><div><button className="text-action" onClick={() => addAssetToTimeline(asset)}>إضافة للخط الزمني</button><button className="icon-button tiny danger" title="حذف الملف المحلي" onClick={async () => { if (projects.some(p => p.clips.some(c => c.mediaId === asset.id)) || project?.clips.some(c => c.mediaId === asset.id)) { setError('لا يمكن حذف الملف لأنه مستخدم داخل مشروع. احذف المقطع من المشروع أو احذف المشروع أولًا.'); return; } if (!confirm(`حذف الملف ${asset.name} من مساحة هذا الجهاز؟`)) return; await database.deleteMedia(asset.id); setMedia(m => m.filter(x => x.id !== asset.id)); setMediaBlobs(m => { const n = new Map(m); n.delete(asset.id); return n; }); setMediaUrls(m => { const n = new Map(m); const url = n.get(asset.id); if (url) URL.revokeObjectURL(url); n.delete(asset.id); return n; }); await refreshStorage(); }}><Trash2 size={14} /></button></div></div></div>)}</div> : <div className="empty-state"><div className="empty-icon"><Film size={32} /></div><h3>مكتبة الوسائط فارغة</h3><p>ابدأ بإضافة فيديوهات من معرض الهاتف أو مدير الملفات.</p><button className="primary-button" onClick={() => fileInputRef.current?.click()}><Plus size={16} /> استيراد فيديو</button></div>}
          </section>
        )}

        {panel === 'audio' && (
          <section className="page-content tool-page"><div className="page-heading"><div><div className="eyebrow">AUDIO STUDIO</div><h1>استوديو الصوت</h1><p>معالجة فعلية للصوت أثناء تصدير الفيديو باستخدام فلاتر FFmpeg.</p></div><div className="tool-heading-icon"><AudioLines size={23} /></div></div>
            <div className="tool-card"><div className="tool-card-title"><div className="tool-icon cyan"><Mic2 size={19} /></div><div><h3>تحسين صوت الكلام</h3><p>تفعيل مرشحات تقليل الضوضاء وتحسين مستوى الصوت.</p></div></div>
              <div className="setting-row"><div><strong>تقليل ضوضاء الخلفية</strong><small>فلتر afftdn — قد يؤثر على الأصوات الهادئة جدًا</small></div><button className={`toggle ${project?.audio.noiseReduction ? 'on' : ''}`} onClick={() => updateAudio({ noiseReduction: !project?.audio.noiseReduction })}><i /></button></div>
              <div className="setting-row"><div><strong>توحيد مستوى الصوت</strong><small>loudnorm لضبط مستوى الصوت النهائي</small></div><button className={`toggle ${project?.audio.normalize ? 'on' : ''}`} onClick={() => updateAudio({ normalize: !project?.audio.normalize })}><i /></button></div>
              <div className="setting-row"><div><strong>إزالة الترددات المنخفضة</strong><small>High-pass عند 80Hz لتقليل الرجة والطنين</small></div><button className={`toggle ${project?.audio.highpass ? 'on' : ''}`} onClick={() => updateAudio({ highpass: !project?.audio.highpass })}><i /></button></div>
              <div className="control-group full"><div className="control-label"><label>مستوى الصوت العام</label><strong>{Math.round((project?.audio.gain ?? 1) * 100)}%</strong></div><input type="range" min="0" max="2" step="0.05" value={project?.audio.gain ?? 1} onChange={e => updateAudio({ gain: Number(e.target.value) })} /></div>
            </div>
            <div className="tool-card">
              <div className="tool-card-title"><div className="tool-icon violet"><Scissors size={19} /></div><div><h3>قص الصمت التلقائي</h3><p>FFmpeg يحلل الصوت على جهازك، ثم تقص الفواصل بضغطة مع هامش يحمي الكلام.</p></div></div>
              <div className="control-group full"><div className="control-label"><label>أقل مدة صمت (ثانية)</label><strong>{silenceThreshold.toFixed(1)}</strong></div><input type="range" min="0.5" max="3" step="0.1" value={silenceThreshold} onChange={e => setSilenceThreshold(Number(e.target.value))} /></div>
              <div className="cloud-actions">
                <button className="primary-button" disabled={!activeClip || busy} onClick={runSilenceDetection}><Scissors size={15} /> تحليل الصمت</button>
                {silenceRanges.length > 0 && <button className="secondary-button" onClick={applySilenceCuts}>تطبيق القص ({silenceRanges.length} فاصل)</button>}
                {silenceRanges.length > 0 && <button className="text-action" onClick={() => setSilenceRanges([])}>إلغاء المقترحات</button>}
              </div>
              {silenceRanges.length > 0 && <div className="cloud-object-list">{silenceRanges.map((range, index) => <div key={`${range.start}-${index}`}><span><strong>{formatTime(range.start)} ← {formatTime(range.end)}</strong><small>صمت {range.duration.toFixed(1)} ثانية</small></span></div>)}</div>}
            </div>
            <div className="info-note"><ShieldCheck size={17} /><span>تظل ملفات الصوت الأصلية دون تغيير. الإعدادات تطبق على ناتج التصدير فقط.</span></div>          </section>
        )}

        {panel === 'color' && (
          <section className="page-content tool-page"><div className="page-heading"><div><div className="eyebrow">COLOR GRADING</div><h1>تصحيح الألوان</h1><p>اضبط الصورة مع معاينة مباشرة وتطبيق نفس الإعدادات عند التصدير.</p></div><div className="tool-heading-icon"><Sun size={23} /></div></div>
            <div className="tool-card"><div className="tool-card-title"><div className="tool-icon violet"><SlidersHorizontal size={19} /></div><div><h3>التحكم الأساسي</h3><p>إعدادات عامة تؤثر على كل المقاطع في المشروع.</p></div></div>
              {[{ key: 'brightness', label: 'السطوع', min: -0.5, max: 0.5, step: 0.01, value: project?.color.brightness ?? 0 }, { key: 'exposure', label: 'التعريض', min: -1, max: 1, step: 0.05, value: project?.color.exposure ?? 0 }, { key: 'contrast', label: 'التباين', min: 0.5, max: 1.8, step: 0.02, value: project?.color.contrast ?? 1 }, { key: 'saturation', label: 'التشبع', min: 0, max: 2, step: 0.02, value: project?.color.saturation ?? 1 }].map(control => <div className="control-group full" key={control.key}><div className="control-label"><label>{control.label}</label><strong>{control.value.toFixed(2)}</strong></div><input type="range" min={control.min} max={control.max} step={control.step} value={control.value} onChange={e => updateColor({ [control.key]: Number(e.target.value) } as Partial<ColorSettings>)} /></div>)}
              <div className="preset-row"><button onClick={() => updateProject(p => ({ ...p, color: { ...DEFAULT_COLOR } }))}>إعادة ضبط</button><button onClick={() => updateColor({ contrast: 1.08, saturation: 1.1, brightness: 0.02, exposure: 0 })}>Cinematic ناعم</button><button onClick={() => updateColor({ contrast: 1.02, saturation: 0.95, brightness: 0.03, exposure: 0.05 })}>Natural Clean</button></div>
            </div>
            <div className="info-note"><Activity size={17} /><span>التعريض والسطوع والتباين والتشبع مدعومة في محرك التصدير. ضبط حرارة اللون غير متاح في هذا الإصدار.</span></div>
          </section>
        )}

        {panel === 'assistant' && (
          <section className="page-content tool-page"><div className="page-heading"><div><div className="eyebrow">AI EDITING ASSISTANT</div><h1>مساعد المونتاج الذكي</h1><p>اكتب طلبك بالعربية، وسأحوّله إلى خطة قابلة للمراجعة قبل تطبيقها.</p></div><div className="tool-heading-icon ai"><Sparkles size={23} /></div></div>
            <div className="assistant-card"><div className="assistant-orb"><WandSparkles size={26} /></div><h2>إيه التعديل اللي في بالك؟</h2><p>المساعد الحالي مجاني ويعمل بقواعد محلية واضحة؛ لا يستخدم API مدفوعًا ولا يدّعي تحليلًا لم يحدث.</p><textarea value={assistantText} onChange={e => setAssistantText(e.target.value)} placeholder="مثال: احذف السكوت الطويل، نظف الصوت، وحسن الإضاءة..." rows={4} /><div className="suggestion-chips"><button onClick={() => setAssistantText('احذف السكوت الطويل مع الحفاظ على الكلام')}>قص السكوت</button><button onClick={() => setAssistantText('نضف الصوت وقلل الضوضاء')}>تنظيف الصوت</button><button onClick={() => setAssistantText('حسن الإضاءة والألوان بشكل سينمائي')}>ألوان سينمائية</button><button onClick={() => setAssistantText('جهز الفيديو لمقاس ريلز 9:16')}>مقاس ريلز</button></div><button className="primary-button wide" onClick={createPlan} disabled={!assistantText.trim()}><Sparkles size={16} /> إنشاء خطة التعديل</button>
              {plan && <div className="plan-result"><div className="plan-title"><div><strong>خطة التعديل المقترحة</strong><small>راجع الخطوات قبل تنفيذها</small></div><span className="review-pill">تحتاج موافقتك</span></div>{plan.operations.length ? plan.operations.map((op, index) => <div className="plan-operation" key={`${op.type}-${index}`}><span className="plan-check"><Check size={13} /></span><div><strong>{op.label}</strong><small>{op.supported ? 'مدعوم في هذا الإصدار' : 'غير مدعوم'}</small></div></div>) : <p className="muted">لم أتعرف على أمر قابل للتنفيذ. استخدم إحدى الأمثلة المقترحة.</p>}<div className="plan-actions"><button className="primary-button" disabled={!plan.operations.length || !project} onClick={applyPlan}><Check size={16} /> تطبيق الخطة</button><button className="secondary-button" onClick={() => setPlan(null)}>إلغاء</button></div></div>}
            </div>
            <div className="info-note"><ShieldCheck size={17} /><span>أوامر المساعد محدودة ومتحقق منها. لا ينفّذ أوامر FFmpeg خام، وكل تعديل قابل للتراجع.</span></div>
          </section>
        )}

        {panel === 'storage' && (
          <section className="page-content tool-page"><div className="page-heading"><div><div className="eyebrow">STORAGE CONTROL</div><h1>إدارة التخزين</h1><p>راجع المساحة المحلية والنسخ السحابي الاختياري.</p></div><div className="tool-heading-icon"><HardDrive size={23} /></div></div>
            <div className="storage-card"><div className="storage-top"><div><small>التخزين المحلي المستخدم</small><strong>{formatBytes(storage.bytes)}</strong></div><div className="storage-ring"><HardDrive size={24} /></div></div><div className="storage-meter"><i style={{ width: `${Math.min(100, storage.bytes / (1024 * 1024 * 1024) * 100)}%` }} /></div><div className="storage-legend"><span>{storage.media} ملف وسائط</span><span>{storage.projects} مشروع</span><span>IndexedDB</span></div><button className="secondary-button" onClick={refreshStorage}><RefreshCw size={15} /> تحديث الاستخدام</button></div>
            <div className="tool-card">
              <div className="tool-card-title">
                <div className="tool-icon green"><HardDrive size={19} /></div>
                <div><h3>OPFS · تخزين التصدير المحلي</h3><p>نسخة من كل فيديو مُصدَّر تبقى على جهازك بعد إعادة فتح التطبيق، بدون رفعها لأي سيرفر.</p></div>
                <span className={`connection-pill ${hasOpfs ? 'connected' : ''}`}>{hasOpfs ? 'مدعوم' : 'غير مدعوم'}</span>
              </div>
              {hasOpfs ? (opfsExports.length ? <div className="cloud-object-list">{opfsExports.map(file => <div key={file.name}><span><strong>{file.name}</strong><small>{formatBytes(file.size)} · {new Date(file.lastModified).toLocaleDateString('ar')}</small></span><span><button className="icon-button tiny" title="تنزيل النسخة المحفوظة" onClick={() => downloadOpfsExport(file.name)}><Download size={13} /></button><button className="icon-button tiny danger" title="حذف من OPFS" onClick={() => removeOpfsExport(file.name)}><Trash2 size={13} /></button></span></div>)}</div> : <div className="cloud-callout">لا توجد نسخ تصدير محفوظة بعد. صدّر فيديو وسيُحفظ هنا تلقائيًا.</div>) : <div className="cloud-callout">هذا المتصفح لا يدعم OPFS. يبقى التخزين المحلي عبر IndexedDB كما هو.</div>}
            </div>
            <div className="tool-card cloud-card">
              <div className="tool-card-title">
                <div className="tool-icon cyan"><Cloud size={19} /></div>
                <div><h3>Cloudflare R2</h3><p>تخزين سحابي خاص خلف Cloudflare Access مع رفع متقطع قابل للاستئناف.</p></div>
                <span className={`connection-pill ${cloudUsage ? 'connected' : ''}`}>{cloudUsage ? 'متصل' : cloudEnabled ? 'بانتظار الدخول' : 'غير موصول'}</span>
              </div>
              <div className="cloud-callout">{cloudUsage ? `استخدام التخزين: ${formatBytes(cloudUsage.usedBytes)} من ${formatBytes(cloudUsage.quotaBytes)} · ${cloudUsage.objectCount} ملفات` : cloudEnabled ? 'المحرر يعمل محليًا. سجّل الدخول عبر Cloudflare Access ثم حدّث حالة R2 لتفعيل النسخ الاحتياطي الاختياري.' : 'لم يتم تفعيل التخزين السحابي على هذا النشر. المحرر يعمل محليًا بالكامل دون أي اشتراك.'}</div>
              {cloudConfig && <div className="cloud-meta"><span>أجزاء الرفع: {formatBytes(cloudConfig.partSize)}</span><span>الحد الأقصى للملف: {formatBytes(cloudConfig.maxFileBytes)}</span>{cloudConfig.d1Enabled && <span>فهرس D1: متاح</span>}{cloudConfig.turnstileSiteKey && <span>حماية Turnstile: مفعّلة</span>}</div>}
              <div className="cloud-actions"><button className="secondary-button" disabled={!cloudEnabled || cloudBusy} onClick={refreshCloud}><RefreshCw size={14} /> تحديث R2</button><a className="doc-link" href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">لوحة Cloudflare <ArrowLeft size={14} /></a></div>
              {cloudProgress && <div className="cloud-progress"><div><span>رفع {cloudProgress.name}</span><strong>{Math.round(cloudProgress.fraction * 100)}%</strong></div><i><b style={{ width: `${Math.round(cloudProgress.fraction * 100)}%` }} /></i></div>}
              {cloudUsage && <div className="cloud-object-list">{cloudObjects.length ? cloudObjects.map(object => <div key={object.key}><span><strong>{(object.name ?? object.key).split('/').at(-1)}</strong><small>{formatBytes(object.size)}</small></span><button className="icon-button tiny danger" disabled={cloudBusy} onClick={() => deleteCloudMedia(object.key)} title="حذف من R2"><Trash2 size={13} /></button></div>) : <small>لا توجد ملفات سحابية بعد.</small>}</div>}
              {cloudEnabled && media.length > 0 && <div className="cloud-upload-picker"><label>نسخ احتياطي اختياري إلى R2</label><select defaultValue="" onChange={e => { const asset = media.find(item => item.id === e.target.value); if (asset) uploadMediaToCloud(asset); e.currentTarget.value = ''; }} disabled={cloudBusy}><option value="">اختر فيديو للرفع المتقطع</option>{media.map(item => <option key={item.id} value={item.id}>{item.name} · {formatBytes(item.size)}</option>)}</select><small>8MB لكل جزء، ويستأنف تلقائيًا عند إعادة رفع نفس الملف بعد انقطاع الشبكة.</small></div>}
            </div>
            <div className="info-note"><ShieldCheck size={17} /><span>لا يتم رفع فيديوهاتك تلقائيًا. لا تُحذف أي ملفات أصلية عند حذف مشروع من المحرر.</span></div>
          </section>
        )}

        {panel === 'settings' && (
          <section className="page-content tool-page"><div className="page-heading"><div><div className="eyebrow">STUDIO SETTINGS</div><h1>إعدادات الاستوديو</h1><p>تفضيلات العرض والتصدير والأمان.</p></div><div className="tool-heading-icon"><Settings2 size={23} /></div></div>
            <div className="tool-card"><div className="tool-card-title"><div className="tool-icon violet"><Download size={19} /></div><div><h3>إعدادات التصدير</h3><p>اختر جودة الملف النهائي.</p></div></div><div className="resolution-options">{(['720p', '1080p', 'source'] as const).map(value => <button className={exportResolution === value ? 'selected' : ''} key={value} onClick={() => setExportResolution(value)}><strong>{value === 'source' ? 'أصلية' : value}</strong><small>{value === '720p' ? 'أخف وأسرع' : value === '1080p' ? 'جودة عالية' : 'حسب المصدر'}</small></button>)}</div><div className="setting-row"><div><strong>نسبة أبعاد المشروع</strong><small>نسبة الإطار عند التصدير</small></div><select value={project?.aspectRatio ?? 'original'} onChange={e => project && commit({ ...project, aspectRatio: e.target.value as Project['aspectRatio'] })}><option value="original">الأصلية</option><option value="16:9">16:9 يوتيوب</option><option value="9:16">9:16 ريلز / Shorts</option><option value="1:1">1:1 مربع</option><option value="4:5">4:5 عمودي</option></select></div></div>
            <div className="tool-card"><div className="tool-card-title"><div className="tool-icon green"><ShieldCheck size={19} /></div><div><h3>الخصوصية والتخزين</h3><p>التحكم في ملفات المشروع.</p></div></div><div className="setting-row"><div><strong>حفظ المشاريع محليًا</strong><small>IndexedDB على هذا المتصفح والجهاز</small></div><span className="active-label">مفعّل</span></div><div className="setting-row"><div><strong>التخزين السحابي</strong><small>لن يتم الرفع إلا بعد إعداد Cloudflare Access</small></div><span className="active-label">اختياري</span></div></div>
            <div className="tool-card"><div className="tool-card-title"><div className="tool-icon violet"><FolderOpen size={19} /></div><div><h3>إدارة المشروع الحالي</h3><p>انسخ المشروع أو احذفه مع الاحتفاظ بملفات الوسائط الأصلية.</p></div></div><div className="project-management-actions"><button className="secondary-button" disabled={!project} onClick={duplicateCurrentProject}><Plus size={15} /> إنشاء نسخة من المشروع</button><button className="secondary-button danger-action" disabled={!project} onClick={deleteCurrentProject}><Trash2 size={15} /> حذف المشروع الحالي</button></div></div>
            <div className="tool-card"><div className="tool-card-title"><div className="tool-icon cyan"><Activity size={19} /></div><div><h3>حالة التكاملات</h3><p>فحص فعلي لقدرات هذا المتصفح وما هو مهيأ على النشر الحالي.</p></div></div>{integrationStatus.map(item => <div className="setting-row" key={item.key}><div><strong>{item.name}</strong><small>{item.note}</small></div><span className={item.active ? 'active-label' : ''}>{item.active ? 'مفعّل' : 'غير مفعّل'}</span></div>)}</div>

          </section>
        )}

        <footer className="main-footer"><span>Made for creators · KHALED CUT AI</span><span><ShieldCheck size={13} /> ملفاتك الأصلية لا يتم تعديلها</span></footer>
      </main>

      <div className="mobile-bottom-nav">{[{ key: 'projects' as const, icon: FolderOpen, label: 'المشاريع' }, { key: 'editor' as const, icon: Clapperboard, label: 'المحرر' }, { key: 'assistant' as const, icon: Sparkles, label: 'AI' }, { key: 'media' as const, icon: Film, label: 'الوسائط' }, { key: 'settings' as const, icon: Settings2, label: 'المزيد' }].map(item => <button key={item.key} className={panel === item.key ? 'active' : ''} onClick={() => setNav(item.key)}><item.icon size={19} /><span>{item.label}</span></button>)}</div>
      <input ref={fileInputRef} className="hidden-input" type="file" accept="video/*,.mp4,.mov,.webm" multiple onChange={e => { if (e.target.files) importFiles(e.target.files); e.currentTarget.value = ''; }} />
      {downloadUrl && <div className="download-ready"><div><span className="download-check"><Check size={15} /></span><div><strong>الفيديو جاهز للتنزيل</strong><small>{downloadName}</small></div></div><button className="primary-button" onClick={downloadExport}><Download size={15} /> تنزيل MP4</button><button className="icon-button" onClick={() => { URL.revokeObjectURL(downloadUrl); setDownloadUrl(null); }}><X size={17} /></button></div>}
      {isDragging && <div className="drop-overlay"><div><Upload size={34} /><strong>أفلت الفيديو هنا</strong><span>سيتم استيراده إلى المشروع الحالي</span></div></div>}
    </div>
  );
}

export default App;
