# Integration status (KHALED CUT AI)

A service is **connected** only when it is configured on the real account and verified.
Everything below was checked on this account on 2026-11-13 (Cloudflare account
`9fda9a2e…ef71`, subdomain `khaledbadawy`; GitHub `khalooda2562008-dotcom`).

## Status table

| Service / tech | Purpose in this project | Available on this account | Free? | Card / billing needed | Limits that matter | Status |
|---|---|---|---|---|---|---|
| **GitHub** | Source of truth | Yes, repo `Khaled_Hany-_cute-` | Yes | No | — | Repo + remote configured; source pushed to `main`. |
| **Cloudflare Workers** | `/api/*` API (auth, uploads, metadata) | Yes, Worker `khaled-cut-ai` exists | Yes (Free plan) | No | 100k requests/day | Code complete, **30 tests + typecheck green**. **Deploy awaits approval.** |
| **Workers Static Assets** | Serves the built app + SPA fallback | Yes | Yes (free, unlimited static requests) | No | — | `wrangler.toml`: `not_found_handling = "single-page-application"`, `run_worker_first = ["/api/*"]`. **Deploy awaits approval.** |
| **R2** | Optional private backup of source media | **No** — API returns `code: 10042 Please enable R2 through the Cloudflare Dashboard` | Yes up to allowance | Dashboard opt-in; may ask for a payment method | 10 GB-month, 1M Class A, 10M Class B, free egress | **Skipped** (no-card rule). Multipart API is implemented + tested and answers `503 R2 not configured` until a bucket is bound. |
| **D1** | Project **metadata** only (never video) | Yes, no database exists yet | Yes | No | 5 GB storage, 5M rows read/day | Schema `migrations/0001_optional_metadata.sql` ready. **Create + migrate awaits approval.** |
| **FFmpeg.wasm** | All editing/rendering on device | — | Yes (self-hosted via unpkg) | No | RAM of the phone | Implemented: silence detect, filters, MP4 export. Core is cached by the service worker. Device test pending. |
| **WebCodecs** | Optional hardware acceleration signal | Browser-dependent | Yes | No | — | Runtime detection + Arabic fallback message in the UI. FFmpeg.wasm stays the reliable path. |
| **Vite PWA** | Installable app + offline shell | — | Yes | No | — | Build verified: `dist/sw.js`, `manifest.webmanifest`, precache 9 entries. |
| **Turnstile** | Bot gate on uploads | Widgets API reachable; none created | Yes | No | 1M challenges/month | Worker verification + client widget implemented and unit-tested. Widget/site key **not created yet** (needs approved account action). |
| **Web Analytics** | Traffic stats | Token has no RUM/analytics scope; app is on `workers.dev` (no zone) | Yes on Free Website plan | No | — | **Skipped.** Worker `[observability]` is enabled instead (built-in logs/metrics). |
| **IndexedDB** | Projects + original media blobs | Browser | Yes | No | Browser quota | Implemented, DB v3 with `uploads` store. |
| **OPFS** | Keeps rendered MP4 exports on device | Modern Chrome/Android | Yes | No | Browser quota | Implemented, wired into the export flow, 3 unit tests. Falls back silently when unsupported. |
| **WaveSurfer.js** | Waveform view of the selected source | — | Yes (MIT) | No | — | Used by `components/WaveformView.tsx`. |
| **Lucide** | Icon set | — | Yes (ISC) | No | — | Used across the UI. |

## What "connected" means here

- **Local features** (FFmpeg, WebCodecs, IndexedDB, OPFS, PWA, WaveSurfer, Lucide): shipped in
  the bundle, verified by `tsc`, unit tests and a production build. No network dependency
  except the one-time FFmpeg core download (cached afterwards).
- **Cloud features** (Workers, Static Assets, D1, Turnstile, R2): only claimed after a live
  request against the deployed Worker. Until the deploy step is approved, they are
  "configured, not deployed".

## Deliberately not enabled

- **R2**: account-level opt-in required; the project rule forbids card entry. The code path
  exists and is tested with a fake bucket, and it refuses to pretend storage works.
- **Web Analytics**: needs a dashboard opt-in/zone; the current API token cannot create it.
- **Any paid plan, paid AI API, remote renderer, or extra SaaS**: not used.

## Verification evidence

```
npx tsc --noEmit          -> clean
npm test                  -> 30 passed (5 files)
npx vite build            -> dist/ + sw.js + manifest.webmanifest
```

## Enabling R2 later (optional, dashboard only)

1. Cloudflare Dashboard → R2 → *Enable R2* (free tier; may ask for a payment method).
2. Create a **private** bucket, e.g. `khaled-cut-ai-media`.
3. Uncomment the `[[r2_buckets]]` block in `wrangler.toml`.
4. `npx wrangler deploy`.
5. `/api/config` then reports `storageEnabled: true` and the storage panel turns on.
