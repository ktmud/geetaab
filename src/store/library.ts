import type { AnalysisResult } from '../core/analyze';
import type { TakeGap } from '../audio/takeTimeline';

export interface StoredSong {
  id: string;
  title: string;
  createdAt: number;
  analysis: AnalysisResult;
  /** ANALYSIS_VERSION at the time the tab was worked out. A number on songs
      saved under the old counter, absent on ones from before versioning at
      all; `analysisIsStale` treats both as stale. */
  analysisVersion?: string | number;
  capo?: number;
  strumId?: string;
  simplify?: boolean;
  level?: 'easy' | 'standard' | 'faithful';
  /** Absent when the recording was never captured or was discarded. */
  audio?: Blob;
  source: 'microphone' | 'file' | 'demo';
  /**
   * Stretches the recorder never received — a call, a hidden tab, headphones
   * going in mid-take. Kept with the song so a tab that reads oddly across one
   * of them has an explanation, rather than looking like the analysis failing.
   */
  gaps?: TakeGap[];
}

export interface SongSummary {
  id: string;
  title: string;
  createdAt: number;
  tempo: number;
  keyName: string;
  capo: number;
  duration: number;
  source: StoredSong['source'];
  hasAudio: boolean;
}

// Renaming this orphans every song already saved in a visitor's browser, so it
// must not follow a future rebrand without a migration that copies the old
// database across first.
const DB_NAME = 'geetaab';
const DB_VERSION = 1;
const STORE = 'songs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no local storage for songs.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the song library.'));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = body(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Song library write failed.'));
        tx.oncomplete = () => db.close();
      }),
  );
}

export function summarize(song: StoredSong): SongSummary {
  return {
    id: song.id,
    title: song.title,
    createdAt: song.createdAt,
    tempo: song.analysis.tempo,
    keyName: song.analysis.key.name,
    capo: song.capo ?? 0,
    duration: song.analysis.duration,
    source: song.source,
    hasAudio: Boolean(song.audio),
  };
}

export async function saveSong(song: StoredSong): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(song));
}

export async function loadSong(id: string): Promise<StoredSong | undefined> {
  return runTransaction<StoredSong | undefined>('readonly', (store) => store.get(id));
}

export async function deleteSong(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id));
}

/**
 * Song summaries, newest first, at most `limit` of them.
 *
 * Reading through the `createdAt` index rather than taking the whole store at
 * once is what makes a large library cheap: a record carries its whole
 * analysis — every beat, every segment — and a handle on its audio, and the
 * list shows none of that. A shelf of fifty songs was fifty of those
 * deserialised on every visit to the home screen to draw six rows.
 */
export async function listSongs(limit?: number): Promise<SongSummary[]> {
  const db = await openDb();
  return new Promise<SongSummary[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).index('createdAt').openCursor(null, 'prev');
    const out: SongSummary[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || (limit != null && out.length >= limit)) {
        resolve(out);
        return;
      }
      out.push(summarize(cursor.value as StoredSong));
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('Could not read the song library.'));
    tx.oncomplete = () => db.close();
  });
}

/** How many songs are stored, without reading any of them. */
export async function countSongs(): Promise<number> {
  return runTransaction<number>('readonly', (store) => store.count());
}

export function newSongId(): string {
  return `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
