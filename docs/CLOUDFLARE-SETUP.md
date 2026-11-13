# Cloudflare setup (free tier only)

Everything here uses the **Free** plan. Do not enable a paid plan, do not add a payment
method for this project, and do not switch on paid add-ons.

## Current account facts (checked 2026-11-13)

- Account: `9fda9a2e…ef71`, workers.dev subdomain `khaledbadawy`.
- Worker `khaled-cut-ai` is deployed at https://khaled-cut-ai.khaledbadawy.workers.dev.
- D1 `khaled-cut-ai-meta` exists (`b626ffe4-a71e-4378-9e43-b9aaa3b39beb`), migrated.
- Zone `khaledbadawy.com` is on the **Free Website** plan.
- No Pages project, no Turnstile widget, no R2 bucket yet.
- R2 is **not enabled**: `code: 10042 — Please enable R2 through the Cloudflare Dashboard`.
- Cloudflare Access is **not enabled** for this account (`access.api.error.not_enabled`).

## Deploy the Worker (app + API)

Already done for this account (kept for reference / a fresh account):

```bash
npx wrangler d1 create khaled-cut-ai-meta      # free
# put the returned database_id into wrangler.toml
npx wrangler d1 execute khaled-cut-ai-meta --remote --file=migrations/0001_optional_metadata.sql
npm run build
npx wrangler deploy
```

`wrangler.toml` already contains:

- `[assets] directory = "./dist"`, `not_found_handling = "single-page-application"`,
  `run_worker_first = ["/api/*"]` → the SPA is served from the edge, `/api/*` goes to code.
- `[[d1_databases]]` → `DB` binding, metadata only.
- `[observability] enabled = true` → free Worker logs/metrics.
- R2 binding **commented out** until the bucket exists.

## Protect the API with Cloudflare Access (free)

1. Dashboard → Zero Trust → Settings → enable **Free** plan (no card).
2. Access → Applications → *Add an application* → **Self-hosted**:
   - Domain: `khaled-cut-ai.khaledbadawy.workers.dev`
   - Path: `api` (protects `/api/*`)
   - Policy: *Allow* → include → **Emails** → the owner's email.
3. Copy the application **Audience (AUD)** tag and the team domain, then:

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN   # e.g. your-team.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD
npx wrangler deploy
```

Without these two values the Worker deliberately returns **503** for
`/api/storage/*` and `/api/projects/*`. There is no anonymous fallback: an unprotected
storage API would expose private media.

## API surface

| Method + path | What it does |
|---|---|
| `GET /api/health` | version + which bindings are live |
| `GET /api/config` | client-safe limits, Turnstile site key |
| `GET /api/storage/usage` | bytes used vs. quota, object count |
| `GET /api/storage/list?prefix=` | private object list (owner namespace only) |
| `GET /api/storage/file?key=` | private download, supports `Range` |
| `POST /api/storage/multipart/create` | start/resume a multipart upload, returns `uploadId` + part size |
| `PUT /api/storage/multipart/part?key=&uploadId=&partNumber=` | upload one part (max 25 MiB) |
| `POST /api/storage/multipart/complete` | complete with the ETag list |
| `POST /api/storage/multipart/abort` | abort a stale upload |
| `GET /api/storage/multipart/session?key=&uploadId=` | check which parts R2 already has |
| `POST /api/storage/delete` | delete one of the caller's objects |
| `GET/PUT /api/projects` | optional D1 metadata sync |

Uploads are **streamed through the Worker** (`R2Bucket.createMultipartUpload` →
`uploadPart` → `complete`), so no R2 S3 keys and no presigned URLs exist anywhere.
The browser keeps the `uploadId`, part size and every ETag in IndexedDB, so an
interrupted upload resumes instead of restarting. Each part is 8 MiB by default,
well under the Workers request-body limit.

## R2 (optional, currently off)

R2 is the only listed service this account cannot use without a dashboard opt-in.
Published free allowance: 10 GB-month, 1M Class A ops, 10M Class B ops, free egress.
The project quota is 10 GB (`STORAGE_QUOTA_BYTES`) and uploads are refused before a
multipart session starts if they would exceed it.

To enable later: Dashboard → R2 → *Enable R2* → create a **private** bucket →
uncomment `[[r2_buckets]]` in `wrangler.toml` → `npx wrangler deploy`.

## Turnstile (free)

After the Worker has a public URL:

1. Dashboard → Turnstile → *Add widget* → hostname `khaled-cut-ai.khaledbadawy.workers.dev`,
   mode *Managed*.
2. `npx wrangler secret put TURNSTILE_SECRET`
3. Add `TURNSTILE_SITE_KEY = "0x…"` to `[vars]` in `wrangler.toml`, deploy.

`/api/config` then returns the site key, the client widget appears in the upload panel,
and `/api/storage/*` rejects requests without a valid token.

## Web Analytics

Not enabled: the Cloudflare API token in use has no RUM scope, and a `workers.dev`
app has no zone to attach Web Analytics to. Worker `[observability]` covers request
logs and errors for free in the meantime.

## Cost guardrails

- Workers Free: 100k requests/day. Static assets are free; only `/api/*` hits the Worker.
- D1 Free: metadata rows only, no blobs.
- Quota enforcement is server-side (`STORAGE_QUOTA_BYTES`) and never auto-upgrades a plan.
- FFmpeg runs in the browser; nothing is rendered on Cloudflare.
