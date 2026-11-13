import { database } from '../store/database';
import type { UploadSession, UploadStore } from '../types/upload';

/** IndexedDB-backed resume store. Falls back to memory when IndexedDB is unavailable. */
export const uploadStore: UploadStore = {
  get: async (id) => (await database.getUploadSession(id)) ?? null,
  put: async (session) => { await database.saveUploadSession(session); },
  delete: async (id) => { await database.deleteUploadSession(id); },
  list: () => database.listUploadSessions(),
};

export class MemoryUploadStore implements UploadStore {
  private sessions = new Map<string, UploadSession>();

  async get(id: string) { return this.sessions.get(id) ?? null; }
  async put(session: UploadSession) { this.sessions.set(session.id, { ...session }); }
  async delete(id: string) { this.sessions.delete(id); }
  async list() { return [...this.sessions.values()]; }
}
