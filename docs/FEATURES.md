# Feature and QA Status

This document separates implemented behavior from planned work. A visible control must not be treated as proof that a backend capability exists.

## Implemented in source

| Feature | Status | Notes |
|---|---|---|
| Responsive Arabic editor shell | Implemented | English localization is not implemented. |
| PWA manifest/service worker | Implemented | Static shell caching only. |
| Video import | Implemented | Uses browser file picker / desktop drag-and-drop; browser codec decoding is required for preview. |
| IndexedDB local source storage | Implemented | Original Blob is stored without overwriting. |
| Project auto-save/reopen | Implemented | Same browser profile/device. |
| Project duplicate/delete | Implemented | Delete removes project metadata only; original media remain in the library. |
| Preview | Implemented | Selected clip preview; does not represent a full compositing monitor. |
| Sequential timeline | Implemented | V1 clip sequence and extracted audio waveform; no independent audio/video tracks. |
| Trim/split/reorder/delete clip | Implemented | Non-destructive timeline operations. |
| Undo/redo | Implemented | In-memory current-session edit history. |
| Silence analysis | Implemented | FFmpeg `silencedetect`; suggestions require user review. |
| Rule-based Arabic editing plan | Implemented | No remote LLM; only known command patterns. |
| Color correction | Implemented | Brightness/exposure, contrast, saturation. |
| Audio enhancement | Implemented | `afftdn`, highpass, loudnorm, gain; filter availability depends on the loaded core. |
| MP4 export | Implemented in code | H.264/AAC path must be tested against actual device/core/inputs. |
| Actual waveform | Implemented | Decodes low-rate mono PCM from selected video using FFmpeg. |
| Cloudflare Worker + R2 | Implemented, not deployed | Private, Access-protected; resumable multipart (8 MiB parts, resume from IndexedDB), 10 GB quota. R2 is not enabled on this account yet. |
| Cloudflare D1 metadata | Implemented, not deployed | Project metadata only (schema in `migrations/`); never video binaries. |
| OPFS export cache | Implemented | Rendered MP4s stay on device and can be re-downloaded or deleted. |
| Turnstile gate | Implemented, not enabled | Needs a widget + secret; storage API rejects requests without a valid token when configured. |
| AI transcription/speech recognition | Not implemented | Never show fabricated transcript. |
| Natural-language LLM editing | Not implemented | Deterministic local parser is used. |
| Multi-track NLE, music/SFX track | Not implemented | Follow-on architecture. |
| Subtitle editor/burn-in | Not implemented | SRT file editing/export is not present. |
| Text/title overlays | Not implemented | Follow-on feature. |
| Transitions/keyframes/speed ramping | Not implemented | Follow-on feature. |
| Advanced color wheels/curves | Not implemented | Follow-on feature. |
| Full English UI | Not implemented | Arabic RTL only for now. |
| Physical Android QA | Not verified | Must be performed on the target phone. |

## Required manual QA before public launch

1. Import a short H.264/AAC MP4 and verify metadata and preview.
2. Create a project, trim, split, reorder, undo, redo, save, refresh, and reopen.
3. Run silence detection on a sample recording with known pauses; verify ranges by listening.
4. Export 720p and 1080p; inspect the resulting MP4 with a media player and a probe tool.
5. Test a silent video, portrait video, variable-frame-rate phone video, MOV, and WEBM separately.
6. Test on Android Chrome with a low-memory device and large files; watch for tab termination and memory errors.
7. Verify Cloudflare Access denies anonymous API requests.
8. Verify one user cannot list/read/delete another user's R2 objects.
9. Verify quota enforcement server-side and multipart resume after interruption once implemented.
