import type { Post } from "../types/post";

export const POSTS_CACHE_VERSION = 1;
const source = import.meta.env.VITE_SUPABASE_URL;
const DATABASE = `social-planner-posts-cache:${source}`;
const POSTS = "publishedPosts";
const METADATA = "metadata";
const STATE_KEY = "state";

export interface PostsCacheMetadata {
  schemaVersion: number;
  source: string;
  initialized: boolean;
  watermark: string;
  refreshedAt: string;
  publishedCount: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB is unavailable.")); return; }
    const request = indexedDB.open(DATABASE, POSTS_CACHE_VERSION);
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      reject(new Error("Opening the posts cache timed out."));
    }, 3000);
    request.onupgradeneeded = () => {
      const db = request.result;
      // A new schema always rebuilds this disposable cache from Supabase.
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      db.createObjectStore(POSTS, { keyPath: "id" });
      db.createObjectStore(METADATA);
    };
    request.onsuccess = () => {
      window.clearTimeout(timer);
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => { window.clearTimeout(timer); settled = true; reject(request.error); };
    request.onblocked = () => {
      window.clearTimeout(timer);
      settled = true;
      reject(new Error("Another tab is blocking the posts cache upgrade."));
    };
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([POSTS, METADATA], mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error || new Error("Posts cache transaction was aborted."));
      tx.onerror = () => reject(tx.error || new Error("Posts cache transaction failed."));
      try { run(tx, (next) => { value = next; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}

export function getPostsCacheSnapshot(): Promise<{ posts: Post[]; metadata?: PostsCacheMetadata }> {
  return transaction("readonly", (tx, result) => {
    const posts = tx.objectStore(POSTS).getAll();
    const metadata = tx.objectStore(METADATA).get(STATE_KEY);
    metadata.onsuccess = () => result({ posts: posts.result, metadata: metadata.result });
  });
}

export async function getCachedPublishedPosts(): Promise<Post[]> {
  return (await getPostsCacheSnapshot()).posts;
}

export async function getPostsCacheMetadata(): Promise<PostsCacheMetadata | undefined> {
  return (await getPostsCacheSnapshot()).metadata;
}

export function isValidPostsCache(snapshot: { posts: Post[]; metadata?: PostsCacheMetadata }): boolean {
  const metadata = snapshot.metadata;
  return Boolean(metadata?.initialized && metadata.schemaVersion === POSTS_CACHE_VERSION
    && metadata.source === source && Number.isFinite(Date.parse(metadata.watermark))
    && metadata.publishedCount === snapshot.posts.length
    && snapshot.posts.every((post) => post && typeof post.id === "string" && post.status === "published"
      && typeof post.platform === "string" && typeof post.contentType === "string"
      && typeof post.date === "string" && typeof post.time === "string"));
}

// Store post objects and the successful refresh boundary in ONE transaction.
// Active records remove any obsolete published version of the same identity.
export function upsertCachedPosts(posts: Post[], metadata?: PostsCacheMetadata, replace = false, removedIds: string[] = []): Promise<void> {
  return transaction("readwrite", (tx) => {
    const store = tx.objectStore(POSTS);
    const metaStore = tx.objectStore(METADATA);
    const previous = metaStore.get(STATE_KEY);
    previous.onsuccess = () => {
      if (replace) store.clear();
      removedIds.forEach((id) => store.delete(id));
      posts.forEach((post) => post.status === "published" ? store.put(post) : store.delete(post.id));
      const count = store.count();
      count.onsuccess = () => {
        const state = metadata || previous.result;
        if (state) metaStore.put({ ...state, publishedCount: count.result }, STATE_KEY);
      };
    };
  });
}

export function removeCachedPost(id: string): Promise<void> {
  return upsertCachedPosts([], undefined, false, [id]);
}

export function setPostsCacheMetadata(metadata: PostsCacheMetadata): Promise<void> {
  return upsertCachedPosts([], metadata);
}

export async function clearPostsCache(): Promise<void> {
  try {
    await transaction<void>("readwrite", (tx) => {
      tx.objectStore(POSTS).clear();
      tx.objectStore(METADATA).clear();
    });
  } catch {
    // Missing stores / a damaged schema cannot be repaired by clearing rows.
    // Delete only this disposable local database and recreate its stores.
    await new Promise<void>((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB is unavailable.")); return; }
      const request = indexedDB.deleteDatabase(DATABASE);
      const timer = window.setTimeout(() => reject(new Error("Resetting the posts cache timed out.")), 3000);
      request.onsuccess = () => { window.clearTimeout(timer); resolve(); };
      request.onerror = () => { window.clearTimeout(timer); reject(request.error); };
      request.onblocked = () => { window.clearTimeout(timer); reject(new Error("Another tab is blocking the cache reset.")); };
    });
    const db = await openDatabase();
    db.close();
  }
}

export function createPostsCacheMetadata(watermark: string): PostsCacheMetadata {
  return { schemaVersion: POSTS_CACHE_VERSION, source, initialized: true, watermark,
    refreshedAt: new Date().toISOString(), publishedCount: 0 };
}
