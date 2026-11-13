export interface UploadPartRecord {
  partNumber: number;
  etag: string;
}

/** Durable resume state for R2 multipart uploads (IndexedDB, never in R2/D1 until completed). */
export interface UploadSession {
  id: string;
  key: string;
  uploadId: string;
  name: string;
  size: number;
  type: string;
  partSize: number;
  parts: UploadPartRecord[];
  createdAt: number;
  updatedAt: number;
  apiBase: string;
}

export interface UploadStore {
  get(id: string): Promise<UploadSession | null>;
  put(session: UploadSession): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<UploadSession[]>;
}

export interface UploadResult {
  key: string;
  size: number;
  resumed: boolean;
}

export interface UploadProgress {
  fraction: number;
  uploadedBytes: number;
  partsDone: number;
  partsTotal: number;
}
