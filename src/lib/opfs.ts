export const hasOpfs = typeof navigator !== 'undefined' && !!navigator.storage && 'getDirectory' in navigator.storage;

const EXPORTS_DIR = 'exports';

async function getExportsDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(EXPORTS_DIR, { create: true });
}

export interface OpfsExport {
  name: string;
  size: number;
  lastModified: number;
}

export async function saveBlobToOpfs(name: string, blob: Blob): Promise<boolean> {
  if (!hasOpfs) return false;
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadBlobFromOpfs(name: string): Promise<Blob | null> {
  if (!hasOpfs) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name);
    return await handle.getFile();
  } catch {
    return null;
  }
}

/** Store a rendered export in OPFS so it survives a reload without re-rendering. */
export async function saveExportToOpfs(name: string, blob: Blob): Promise<boolean> {
  if (!hasOpfs) return false;
  try {
    const dir = await getExportsDirectory();
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function listOpfsExports(): Promise<OpfsExport[]> {
  if (!hasOpfs) return [];
  try {
    const dir = await getExportsDirectory();
    const items: OpfsExport[] = [];
    // @ts-expect-error async iteration is available in browsers that ship OPFS,
    // but not in every TypeScript lib version.
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      try {
        const file = await handle.getFile();
        items.push({ name, size: file.size, lastModified: file.lastModified });
      } catch {
        // A file can disappear between listing and reading; skip it.
      }
    }
    return items.sort((a, b) => b.lastModified - a.lastModified);
  } catch {
    return [];
  }
}

export async function loadOpfsExport(name: string): Promise<Blob | null> {
  if (!hasOpfs) return null;
  try {
    const dir = await getExportsDirectory();
    const handle = await dir.getFileHandle(name);
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function deleteOpfsExport(name: string): Promise<boolean> {
  if (!hasOpfs) return false;
  try {
    const dir = await getExportsDirectory();
    await dir.removeEntry(name);
    return true;
  } catch {
    return false;
  }
}
