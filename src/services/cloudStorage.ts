import { uploadMedia, type UploadOptions } from './multipartUpload';

const API_BASE = import.meta.env.VITE_CLOUD_API_BASE || '/api';

export interface CloudUsage { usedBytes: number; quotaBytes: number; objectCount: number; remainingBytes?: number }
export interface CloudObject { key: string; name?: string; size: number; uploaded: string; contentType?: string }
export interface CloudConfig {
  storageEnabled: boolean;
  accessEnabled: boolean;
  d1Enabled: boolean;
  turnstileSiteKey: string | null;
  partSize: number;
  maxFileBytes: number;
  quotaBytes: number;
}
export interface CloudUploadOptions {
  onProgress?: (fraction: number, uploadedBytes: number) => void;
  signal?: AbortSignal;
  turnstileToken?: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Cloud storage request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export const cloudStorage = {
  config: () => api<CloudConfig>('/config'),
  usage: () => api<CloudUsage>('/storage/usage'),
  list: () => api<{ objects: CloudObject[] }>('/storage/list'),
  /**
   * Resumable multipart upload to the private R2 bucket.
   * Progress is reported per 8 MiB part and an interrupted upload resumes from
   * the next missing part (state is kept in IndexedDB, not in the URL).
   */
  upload: (file: File, options: CloudUploadOptions = {}) => uploadMedia(file, {
    apiBase: API_BASE,
    signal: options.signal,
    turnstileToken: options.turnstileToken,
    onProgress: progress => options.onProgress?.(progress.fraction, progress.uploadedBytes),
  } satisfies UploadOptions),
  remove: (key: string) => api<{ deleted: boolean }>('/storage/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  }),
  /** Authenticated, private download URL (session cookie is sent by the browser). */
  fileUrl: (key: string) => `${API_BASE}/storage/file?key=${encodeURIComponent(key)}`,
  projectMetadata: {
    list: () => api<{ projects: Array<{ id: string; name: string; updatedAt: number; durationSec: number; clipCount: number; sizeBytes: number }> }>('/projects'),
    save: (project: { id: string; name: string; updatedAt: number; durationSec: number; clipCount: number; sizeBytes: number }) => api<{ saved: boolean }>('/projects', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(project),
    }),
    remove: (id: string) => api<{ deleted: boolean }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
};
