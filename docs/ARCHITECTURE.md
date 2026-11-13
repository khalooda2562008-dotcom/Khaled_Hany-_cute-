# Architecture

```text
Android / Desktop Browser
          |
          v
React + TypeScript + Vite PWA
          |
          +--> IndexedDB: projects, edits, source-media Blobs, upload sessions
          |
          +--> OPFS: rendered MP4 exports kept on device
          |
          +--> FFmpeg.wasm in browser Worker
          |       +--> silence detection
          |       +--> audio waveform extraction
          |       +--> non-destructive render/export pipeline
          |
          +--> Optional same-origin /api/storage/*
                    |
                    v
             Cloudflare Worker
                    |
             Cloudflare Access JWT
                    |
                    v
                 R2 private bucket

                 D1: project metadata only (same Worker, optional)

No presigned URLs and no S3 keys: the Worker streams multipart parts itself.
```

## Trust boundaries

- Browser stores original media locally. The current app does not upload automatically.
- Worker endpoints must verify Cloudflare Access JWT issuer, audience, signature, expiry, and subject.
- R2 object keys are isolated by a one-way hash of the Access subject.
- Secrets stay in Worker secret storage.
- FFmpeg runs in browser workers, not in Cloudflare request handlers.

## Current data model

- `Project`: project ID/name, timestamps, clip sequence, color/audio settings, aspect ratio and export resolution.
- `MediaAsset`: ID, filename, MIME, byte size, duration, width, height, and audio presence metadata.
- `TimelineClip`: media reference, source in/out points, speed, clip volume and mute state.
- `UploadSession`: multipart upload ID, object key, part size, ETags per part, bytes uploaded, status (IndexedDB `uploads` store).

## Future data model extensions

- `Track`: typed V/A/T/overlay lane, order, mute/solo/lock.
- `TimelineClip`: timeline start, source in/out, keyframes, transforms, effects, transitions and per-clip audio.
- `CaptionCue`: source text, start/end, language, style and position.
- `ProjectRevision`: snapshot ID, parent revision, timestamp and edit operation summary.
