import type { Post } from "../types/post";
import { fetchPosts, type PostsRefreshScope } from "./supabasePosts";
import { clearPostsCache, createPostsCacheMetadata, getPostsCacheSnapshot, isValidPostsCache,
  removeCachedPost, upsertCachedPosts } from "./postsCache";

export interface PostsLoadResult {
  posts: Post[];
  error?: unknown;
  cacheUnavailable?: boolean;
}

// Serialize refreshes and cache mutations; Web Locks also serialize tabs on
// browsers that support them. A scoped sync never advances the global boundary.
let pending: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request("social-planner-posts-cache", work);
    }
    return work();
  };
  const result = pending.then(run, run);
  pending = result.catch(() => undefined);
  return result;
}

export function mergePosts(...collections: Post[][]): Post[] {
  const map = new Map<string, Post>();
  collections.forEach((posts) => posts.forEach((post) => map.set(post.id, post)));
  return [...map.values()].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || b.id.localeCompare(a.id));
}

export function loadPostsWithCache(onCached?: (posts: Post[]) => void, rebuild = false): Promise<PostsLoadResult> {
  return exclusive(async () => {
    let snapshot: Awaited<ReturnType<typeof getPostsCacheSnapshot>> | undefined;
    if (!rebuild) {
      try {
        const candidate = await getPostsCacheSnapshot();
        if (isValidPostsCache(candidate)) snapshot = candidate;
      } catch { /* Supabase remains usable when storage is blocked or corrupt. */ }
    } else {
      try { await clearPostsCache(); } catch { /* Still refresh from Supabase. */ }
    }
    if (snapshot) onCached?.(mergePosts(snapshot.posts));

    try {
      // Capture the refresh START, not its completion: changes committed while
      // pages load must remain discoverable next time. The five-minute inclusive
      // overlap covers timestamp ties and modest clock skew. Never use the newest
      // row's timestamp as a moving boundary (it may stay unchanged for months).
      const watermark = new Date().toISOString();
      const since = snapshot?.metadata?.watermark;
      const changedSince = since ? new Date(Math.max(0, Math.min(Date.parse(since), Date.parse(watermark)) - 5 * 60_000)).toISOString() : undefined;
      const live = await fetchPosts({ changedSince });
      let cacheUnavailable = false;
      try {
        const metadata = createPostsCacheMetadata(watermark);
        await upsertCachedPosts(live, metadata, !snapshot);
      } catch {
        try {
          await clearPostsCache();
          await upsertCachedPosts(mergePosts(snapshot?.posts || [], live), createPostsCacheMetadata(watermark), true);
        } catch { cacheUnavailable = true; }
      }
      return { posts: mergePosts(snapshot?.posts || [], live), cacheUnavailable };
    } catch (error) {
      if (snapshot) return { posts: mergePosts(snapshot.posts), error };
      throw error;
    }
  });
}

export function refreshScopedPosts(scope: PostsRefreshScope): Promise<PostsLoadResult> {
  return exclusive(async () => {
    const posts = await fetchPosts({ scope });
    let cacheUnavailable = false;
    try { await upsertCachedPosts(posts); } catch { cacheUnavailable = true; }
    return { posts, cacheUnavailable };
  });
}

// Cache failures must never make a successful Supabase mutation look failed.
// Invalidate metadata when possible so the next startup safely rebuilds.
export function cachePostChanges(posts: Post[], deletedId?: string): Promise<boolean> {
  return exclusive(async () => {
    try {
      if (deletedId) await removeCachedPost(deletedId);
      else await upsertCachedPosts(posts);
      return true;
    } catch {
      try { await clearPostsCache(); } catch { /* Storage may be unavailable. */ }
      return false;
    }
  });
}
