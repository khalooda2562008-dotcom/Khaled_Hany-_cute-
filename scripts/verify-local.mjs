// End-to-end verification against a real local Workers runtime (Miniflare R2 + D1).
// Run: node scripts/verify-local.mjs [baseUrl]
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const MiB = 1024 * 1024;
const checks = [];

function ok(name, condition, detail = '') {
  checks.push({ name, condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function json(response) {
  return response.json().catch(() => ({}));
}

async function main() {
  const health = await fetch(`${BASE}/api/health`);
  const healthBody = await json(health);
  ok('Worker answers /api/health', health.ok && healthBody.ok === true, JSON.stringify(healthBody.features ?? {}));
  ok('Static assets are served', (await fetch(`${BASE}/`)).status === 200);

  const config = await json(await fetch(`${BASE}/api/config`));
  ok('Public config exposes no secrets', !JSON.stringify(config).includes('secret'));

  const size = 12 * MiB + 1234;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 997) bytes[i] = (i * 31) % 251;

  const created = await fetch(`${BASE}/api/storage/multipart/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'اختبار-الرفع.mp4', size, type: 'video/mp4' }),
  });
  const session = await json(created);
  ok('Multipart upload created', created.status === 201 && Boolean(session.uploadId), `partSize=${session.partSize}`);

  const parts = [];
  for (let partNumber = 1; partNumber <= Math.ceil(size / session.partSize); partNumber++) {
    const start = (partNumber - 1) * session.partSize;
    const chunk = bytes.slice(start, Math.min(size, start + session.partSize));
    const response = await fetch(
      `${BASE}/api/storage/multipart/part?key=${encodeURIComponent(session.key)}&uploadId=${encodeURIComponent(session.uploadId)}&part=${partNumber}`,
      { method: 'PUT', headers: { 'content-length': String(chunk.byteLength) }, body: chunk },
    );
    const body = await json(response);
    if (response.ok) parts.push({ partNumber: body.partNumber, etag: body.etag });
    ok(`Part ${partNumber} uploaded (${(chunk.byteLength / MiB).toFixed(2)} MiB)`, response.ok && Boolean(body.etag));
  }
  ok('Parts numbered consecutively', parts.length === Math.ceil(size / session.partSize));

  const completed = await fetch(`${BASE}/api/storage/multipart/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: session.key, uploadId: session.uploadId, parts }),
  });
  const completedBody = await json(completed);
  ok('Multipart upload completed', completed.ok && completedBody.size === size, `size=${completedBody.size}`);

  const listing = await json(await fetch(`${BASE}/api/storage/list`));
  ok('Object is listed under the private namespace', listing.objects?.length === 1 && listing.objects[0].key.startsWith('users/'));

  const download = await fetch(`${BASE}/api/storage/file?key=${encodeURIComponent(session.key)}`);
  const downloaded = new Uint8Array(await download.arrayBuffer());
  let identical = downloaded.byteLength === size;
  for (let i = 0; identical && i < size; i += 4099) identical = downloaded[i] === bytes[i];
  ok('Private download matches the uploaded bytes', download.ok && identical, `content-disposition=${download.headers.get('content-disposition')}`);
  ok('Download is not publicly cacheable', (download.headers.get('cache-control') ?? '').includes('private'));

  const usage = await json(await fetch(`${BASE}/api/storage/usage`));
  ok('Usage accounting reports the stored bytes', usage.usedBytes === size, `used=${usage.usedBytes}`);

  const deleted = await fetch(`${BASE}/api/storage/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: session.key }),
  });
  const usageAfter = await json(await fetch(`${BASE}/api/storage/usage`));
  ok('Delete frees the object', deleted.ok && usageAfter.usedBytes === 0);

  const traversal = await fetch(`${BASE}/api/storage/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'users/../../etc/passwd' }),
  });
  ok('Object-key traversal is rejected', traversal.status === 403);

  const saved = await fetch(`${BASE}/api/projects`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'verify_project', name: 'تحقق D1', updatedAt: Date.now(), durationSec: 12.5, clipCount: 2, sizeBytes: 2048 }),
  });
  const listed = await json(await fetch(`${BASE}/api/projects`));
  ok('D1 metadata save + read works (no video bytes)', saved.ok && listed.projects?.some(project => project.id === 'verify_project'));
  const removed = await fetch(`${BASE}/api/projects/verify_project`, { method: 'DELETE' });
  ok('D1 metadata delete works', removed.ok);

  const failed = checks.filter(check => !check.condition);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error('Verification crashed:', error);
  process.exitCode = 1;
});
