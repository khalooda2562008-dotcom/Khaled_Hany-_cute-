import type { MediaAsset, Project } from '../types/editor';
import type { UploadSession } from '../types/upload';

const DB_NAME = 'khaled-cut-ai-db';
const DB_VERSION = 3;
const PROJECTS = 'projects';
const MEDIA = 'media';
const MEDIA_META = 'mediaMeta';
const UPLOADS = 'uploads';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MEDIA_META)) db.createObjectStore(MEDIA_META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(UPLOADS)) db.createObjectStore(UPLOADS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local project database.'));
  });
}

async function requestValue<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = action(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB operation failed.'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
  });
}

export const database = {
  saveProject: (project: Project) => requestValue<IDBValidKey>(PROJECTS, 'readwrite', s => s.put(project)),
  getProjects: () => requestValue<Project[]>(PROJECTS, 'readonly', s => s.getAll()),
  getProject: (id: string) => requestValue<Project | undefined>(PROJECTS, 'readonly', s => s.get(id)),
  deleteProject: (id: string) => requestValue<undefined>(PROJECTS, 'readwrite', s => s.delete(id)),
  saveMedia: async (asset: MediaAsset, blob: Blob) => {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([MEDIA, MEDIA_META], 'readwrite');
      tx.objectStore(MEDIA).put({ ...asset, blob });
      tx.objectStore(MEDIA_META).put(asset);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not save media.')); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Media save was aborted.')); };
    });
  },
  getMedia: (id: string) => requestValue<(MediaAsset & { blob: Blob }) | undefined>(MEDIA, 'readonly', s => s.get(id)),
  getAllMedia: () => requestValue<Array<MediaAsset & { blob: Blob }>>(MEDIA, 'readonly', s => s.getAll()),
  deleteMedia: async (id: string) => {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([MEDIA, MEDIA_META], 'readwrite');
      tx.objectStore(MEDIA).delete(id); tx.objectStore(MEDIA_META).delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not delete media.')); };
    });
  },
  saveUploadSession: (session: UploadSession) => requestValue<IDBValidKey>(UPLOADS, 'readwrite', s => s.put(session)),
  getUploadSession: (id: string) => requestValue<UploadSession | undefined>(UPLOADS, 'readonly', s => s.get(id)),
  deleteUploadSession: (id: string) => requestValue<undefined>(UPLOADS, 'readwrite', s => s.delete(id)),
  listUploadSessions: () => requestValue<UploadSession[]>(UPLOADS, 'readonly', s => s.getAll()),
  estimate: async () => {
    const [projects, media] = await Promise.all([
      requestValue<Project[]>(PROJECTS, 'readonly', s => s.getAll()),
      requestValue<MediaAsset[]>(MEDIA_META, 'readonly', s => s.getAll()),
    ]);
    return { projects: projects.length, media: media.length, bytes: media.reduce((sum, item) => sum + item.size, 0) };
  },
};
