# KHALED CUT AI

A mobile-first, Arabic-first local video editor built with React, TypeScript, Vite, IndexedDB/OPFS, and FFmpeg.wasm.

> **Status:** Working local editor (MVP), packaged for a single Cloudflare Worker with Static Assets. It is not a full Premiere Pro replacement. See [FEATURES.md](docs/FEATURES.md) and [INTEGRATION-STATUS.md](docs/INTEGRATION-STATUS.md) for the exact implemented and connected features.

## What works in this repository

- Responsive dark editor interface, optimized for mobile browsers.
- Local multi-file video import through the system file picker and desktop drag-and-drop.
- Project metadata and original source blobs stored in IndexedDB; no upload is required to edit locally.
- Project auto-save and reopening on the same browser/device.
- Video preview, timeline clip selection, reorder, trim-in/out, split, remove-from-timeline, and undo/redo.
- FFmpeg.wasm silence analysis using `silencedetect`, with reviewable cuts and safety padding before applying.
- A deterministic Arabic command parser that creates a reviewable editing plan without requiring an AI API key.
- Audio export filters: optional `afftdn`, `highpass`, `loudnorm`, and volume adjustment.
- Color export filters: brightness/exposure, contrast, and saturation.
- MP4/H.264/AAC export pipeline with a downloadable output, subject to browser/WASM codec support and device memory.
- Real audio waveform extraction from the selected source using FFmpeg, drawn with WaveSurfer.js.
- Local-first persistence: IndexedDB for projects and original media, OPFS for rendered MP4 exports
  (kept on device, re-downloadable after a reload, with a delete action).
- Optional private Cloudflare R2 backup behind Cloudflare Access, with resumable multipart upload
  (8 MiB parts, ETag/session state in IndexedDB, resume after network loss), a 10 GB server-side quota,
  and Range downloads. Disabled unless R2 + Access are configured.
- Optional D1 project metadata index (`/api/projects`), never video binaries.
- Optional Turnstile check on storage endpoints.
- PWA manifest and service worker for the application shell, plus a CacheFirst rule for the FFmpeg core.
- Honest integration panel in Settings showing which capabilities are actually active.

## Important limitations (do not mistake these for completed features)

- The interface is currently Arabic RTL only; full English localization is not included yet.
- Multi-clip sequential video editing is implemented, but this is not a full arbitrary multi-track NLE.
- Timeline audio display is the actual waveform extracted from the selected video source; separate imported music/SFX tracks are not implemented.
- AI assistant is a free deterministic rule-based parser, not an LLM. It does not transcribe speech, recognize speakers, understand scenes, or invent edits.
- Silence removal detects low-volume ranges. It is not speech-aware and cannot guarantee that every pause is expendable; always review suggestions.
- Color temperature is not implemented. Brightness/exposure, contrast, and saturation are applied to preview/export.
- Subtitle editing/burning, title templates, keyframes, motion graphics, speed ramps, transitions, proxy workflows, and professional color wheels are not implemented.
- R2 storage is optional and currently **not enabled on the Cloudflare account** (the account needs a dashboard opt-in). The app therefore works fully locally, and the storage panel says so instead of pretending.
- Cloudflare Access must be configured before the storage/metadata API answers anything but 503.
- Web Analytics is not enabled (no zone for the `workers.dev` app, token lacks the scope); Worker observability is on instead.
- The export pipeline assumes that FFmpeg.wasm can decode the input streams and includes the required H.264/AAC encoders and filters. Actual format support depends on the FFmpeg core build and browser/device resources.
- Source-resolution export normalizes clips to the first clip's dimensions. Clips with very different aspect ratios are padded, not intelligently reframed.
- No mobile device/browser has been physically tested from this build environment.

## Requirements

- Node.js 22 or newer recommended.
- npm 10 or newer recommended.
- A modern browser. Android Chrome is the primary target.
- Internet access the first time FFmpeg.wasm loads its core from unpkg. The core is fetched on demand to avoid placing a large WASM binary in the application bundle.

## Run locally

```bash
npm install
npm run dev
```

Open the printed Vite URL on your computer. To test on Android while both devices are on the same network, open the development URL using the computer's LAN IP and port 5173. Some browser features behave differently on plain HTTP; use HTTPS for real PWA installation and Cloudflare Access integration.

## Build

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

## GitHub

The project is connected to `https://github.com/khalooda2562008-dotcom/Khaled_Hany-_cute-.git`
(branch `main`). Pushing requires owner approval.

A CI workflow (typecheck + tests + build) is ready to drop into `.github/workflows/`, but the
GitHub login used here only has `repo` scope: pushing workflow files needs the `workflow` scope.
Run `gh auth refresh -h github.com -s workflow` once, then add the workflow file.

## Cloudflare

The app and the API are deployed together as a single Worker with Static Assets, so there is
one URL and no CORS. See [Cloudflare setup](docs/CLOUDFLARE-SETUP.md) and
[integration status](docs/INTEGRATION-STATUS.md) for what is actually live on the account.

```bash
npx wrangler d1 create khaled-cut-ai-meta     # free, metadata only
npx wrangler d1 execute khaled-cut-ai-meta --remote --file=migrations/0001_optional_metadata.sql
npm run build
npx wrangler deploy
```

Recommended architecture:

- **Workers Static Assets**: serve the web app (SPA fallback, `/api/*` to the Worker).
- **Workers**: small authenticated API endpoints only.
- **R2**: private source-media backup (optional, not enabled on this account yet).
- **Cloudflare Access**: protect the private API (required for `/api/*` storage).
- **D1**: optional project metadata only; local IndexedDB remains the source of truth.

Do not run FFmpeg encoding inside ordinary Worker request handlers. Video rendering belongs on the user's device for the no-paid-server mode.

### Worker bindings and secrets

`wrangler.toml` defines the `ASSETS` and `DB` bindings. The Worker reads:

- `CF_ACCESS_TEAM_DOMAIN` (secret; e.g. `your-team.cloudflareaccess.com`)
- `CF_ACCESS_AUD` (secret; the Access application's Audience tag)
- `TURNSTILE_SECRET` + `TURNSTILE_SITE_KEY` (optional bot protection)
- `STORAGE_QUOTA_BYTES` (default 10,000,000,000 = 10 GB)
- `MAX_UPLOAD_BYTES` (default 2 GiB per file), `MAX_PART_BYTES` (default 25 MiB)

The R2 bucket stays private. The Worker verifies `Cf-Access-Jwt-Assertion`, validates issuer and
audience, hashes the Access subject into the object prefix, and scopes list/delete to that prefix.
Uploads are streamed through the Worker's R2 multipart API — no S3 keys and no presigned URLs are
needed, and the browser resumes from IndexedDB state after an interruption.

### Secrets

This starter does not need a Cloudflare API token in the frontend. Never add Cloudflare account tokens, R2 secret keys, AI provider keys, or signing keys to `VITE_*` variables or committed files. Worker secrets belong in the Cloudflare Worker secret store.

## Cost policy

- Local editing and local rendering do not need a paid AI API or rendering server.
- Cloudflare R2 has a free allowance, but use beyond included storage/operation limits can cost money. Current published pricing lists 10 GB-month storage, 1 million Class A operations, and 10 million Class B operations in the free tier. Review the current pricing before enabling uploads.
- Workers Free has request/CPU limits; static asset serving is free and unlimited, but requests that invoke Worker code count against the Worker quota.
- Do not enable paid plans, paid AI, paid storage, paid video services, or remote rendering without explicit approval.

## Browser storage and backups

IndexedDB is local to the browser profile/device. Clearing site data, using an incognito/private profile, or switching devices may remove access to local projects. Export/backup synchronization is an important follow-on feature. Do not treat browser storage as the only safe backup for important source videos.

## Security

- Keep the R2 bucket private.
- Put Access in front of the Worker API.
- Keep signing credentials in Worker secrets only.
- Enforce ownership and quotas server-side, not only in the UI.
- Use short-lived signed URLs for multipart object operations.
- Validate actual media type and size on the server.
- Do not use user media to train external models.

## License

This repository contains original application code. FFmpeg.wasm and its dependencies retain their own licenses; review their upstream license terms before redistribution.
