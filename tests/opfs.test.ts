import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StoredFile = { name: string; blob: Blob; lastModified: number };

function makeWritableHandle(file: StoredFile) {
  return {
    kind: 'file' as const,
    name: file.name,
    async getFile() {
      return new File([file.blob], file.name, { lastModified: file.lastModified });
    },
    async createWritable() {
      return {
        async write(value: Blob) {
          file.blob = value;
          file.lastModified = Date.now();
        },
        async close() {},
      };
    },
  };
}

function makeDirectory(files = new Map<string, StoredFile>(), dirs: Map<string, any> = new Map()) {
  return {
    kind: 'directory' as const,
    files,
    async getFileHandle(name: string, options?: { create?: boolean }) {
      let file = files.get(name);
      if (!file) {
        if (!options?.create) throw new DOMException('not found', 'NotFoundError');
        file = { name, blob: new Blob(), lastModified: Date.now() };
        files.set(name, file);
      }
      return makeWritableHandle(file);
    },
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      let dir = dirs.get(name);
      if (!dir) {
        if (!options?.create) throw new DOMException('not found', 'NotFoundError');
        dir = makeDirectory();
        dirs.set(name, dir);
      }
      return dir;
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw new DOMException('not found', 'NotFoundError');
    },
    async *entries() {
      for (const file of files.values()) yield [file.name, makeWritableHandle(file)] as const;
    },
  };
}

async function loadOpfsModule() {
  vi.resetModules();
  return import('../src/lib/opfs');
}

describe('OPFS local export storage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports no support and fails softly when navigator.storage is absent', async () => {
    vi.stubGlobal('navigator', {});
    const opfs = await loadOpfsModule();
    expect(opfs.hasOpfs).toBe(false);
    expect(await opfs.saveExportToOpfs('a.mp4', new Blob(['x']))).toBe(false);
    expect(await opfs.listOpfsExports()).toEqual([]);
    expect(await opfs.loadOpfsExport('a.mp4')).toBeNull();
    expect(await opfs.deleteOpfsExport('a.mp4')).toBe(false);
  });

  it('saves, lists, reloads and deletes an export through OPFS', async () => {
    const root = makeDirectory();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
    const opfs = await loadOpfsModule();

    expect(opfs.hasOpfs).toBe(true);
    expect(await opfs.saveExportToOpfs('cut.mp4', new Blob(['video-bytes']))).toBe(true);

    const listed = await opfs.listOpfsExports();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('cut.mp4');
    expect(listed[0].size).toBe('video-bytes'.length);

    const loaded = await opfs.loadOpfsExport('cut.mp4');
    expect(await loaded?.text()).toBe('video-bytes');

    expect(await opfs.deleteOpfsExport('cut.mp4')).toBe(true);
    expect(await opfs.listOpfsExports()).toEqual([]);
    expect(await opfs.loadOpfsExport('cut.mp4')).toBeNull();
  });

  it('keeps a plain blob helper for the root directory', async () => {
    const root = makeDirectory();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
    const opfs = await loadOpfsModule();

    expect(await opfs.saveBlobToOpfs('raw.bin', new Blob(['abc']))).toBe(true);
    const restored = await opfs.loadBlobFromOpfs('raw.bin');
    expect(await restored?.text()).toBe('abc');
  });
});
