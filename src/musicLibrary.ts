/** User-imported MP3s in IndexedDB. Every call degrades to empty/false on failure (private mode, blocked). */

export const MAX_BYTES = 500 * 1024 * 1024;
const DB = 'drifta-music';
const STORE = 'tracks';

export interface TrackInfo {
  id: string;
  name: string;
  size: number;
}

export const isMp3 = (f: { name: string; type: string }) =>
  f.type === 'audio/mpeg' || /\.mp3$/i.test(f.name);

/** Pure import planning: which files to take, given what is stored. */
export function planImport(
  files: { name: string; size: number; type: string }[],
  existing: { name: string; size: number }[],
  usedBytes: number,
  cap = MAX_BYTES,
): { accept: number[]; skipped: number; reason?: string } {
  const seen = new Set(existing.map((e) => `${e.name}|${e.size}`));
  const accept: number[] = [];
  let used = usedBytes;
  let skipped = 0;
  let reason: string | undefined;
  files.forEach((f, i) => {
    const key = `${f.name}|${f.size}`;
    if (!isMp3(f) || seen.has(key)) {
      skipped++;
      return;
    }
    if (used + f.size > cap) {
      skipped++;
      reason = 'library full (500 MB)';
      return;
    }
    seen.add(key);
    used += f.size;
    accept.push(i);
  });
  return { accept, skipped, reason };
}

/** Shuffle bag: no repeats until all played; after a reshuffle the first is never the last played. */
export function createShuffleBag<T>(items: T[], rng: () => number = Math.random) {
  let bag: T[] = [];
  let last: T | undefined;
  let hasLast = false;
  const refill = () => {
    bag = [...items];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // next() pops from the end; swap the last-played item out of that slot
    if (hasLast && bag.length > 1 && bag[bag.length - 1] === last) {
      const k = Math.floor(rng() * (bag.length - 1));
      [bag[bag.length - 1], bag[k]] = [bag[k], bag[bag.length - 1]];
    }
  };
  return {
    next(): T {
      if (!bag.length) refill();
      last = bag.pop() as T;
      hasLast = true;
      return last;
    },
  };
}

// shortcut: IndexedDB layer untested (no fake-indexeddb dep), add if it grows
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('blocked'));
  });
}

async function tx<R>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<R>,
  fallback: R,
): Promise<R> {
  try {
    const db = await open();
    try {
      return await new Promise<R>((resolve) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(fallback);
      });
    } finally {
      db.close();
    }
  } catch {
    return fallback;
  }
}

interface Row extends TrackInfo {
  blob: Blob;
}

export async function listTracks(): Promise<TrackInfo[]> {
  const rows = await tx<Row[]>('readonly', (s) => s.getAll() as IDBRequest<Row[]>, []);
  return rows.map(({ id, name, size }) => ({ id, name, size }));
}

export async function libraryBytes(): Promise<number> {
  return (await listTracks()).reduce((n, t) => n + t.size, 0);
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const row = await tx<Row | undefined>('readonly', (s) => s.get(id), undefined);
  return row?.blob;
}

export async function clearLibrary(): Promise<void> {
  await tx('readwrite', (s) => s.clear(), undefined);
}

export async function importFiles(
  files: File[],
): Promise<{ added: number; skipped: number; reason?: string }> {
  const existing = await listTracks();
  const plan = planImport(
    files,
    existing,
    existing.reduce((n, t) => n + t.size, 0),
  );
  let added = 0;
  for (const i of plan.accept) {
    const f = files[i];
    const row: Row = { id: crypto.randomUUID(), name: f.name, size: f.size, blob: f };
    const ok = await tx<IDBValidKey | undefined>(
      'readwrite',
      (s) => s.add(row) as IDBRequest<IDBValidKey | undefined>,
      undefined,
    );
    if (ok !== undefined) added++;
  }
  const failed = plan.accept.length - added;
  const reason = plan.reason ?? (failed ? 'could not save' : undefined);
  return reason
    ? { added, skipped: plan.skipped + failed, reason }
    : { added, skipped: plan.skipped + failed };
}
