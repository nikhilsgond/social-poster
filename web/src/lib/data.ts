// src/lib/data.ts
// Pure data-layer functions — no internal state.
// Phase 4: Supabase is the source of truth. localStorage is cache-only.
// The React context (PostContext) owns the state and calls supabasePosts.ts functions.
// This file is preserved for reference and potential offline caching in future phases.

import type { Platform, Post } from "../types/post";
import { normalizePost, generateId } from "./validation";

const STORE_KEY = "social_planner_posts_v2";
const LEGACY_STORE_KEY = "sp_posts";

// ── ID Generation ──
export function generatePostId(): string {
  return "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

// ── Pure State Mutations (return new arrays, never mutate) ──

export function addPostToArray(posts: Post[], data: Omit<Post, "id" | "createdAt" | "updatedAt">): Post[] {
  const now = Date.now().toString();
  return [...posts, { ...data, id: generatePostId(), createdAt: now, updatedAt: now }];
}

export function updatePostInArray(posts: Post[], id: string, changes: Partial<Post>): Post[] {
  return posts.map((p) =>
    p.id === id ? { ...p, ...changes, updatedAt: Date.now().toString() } : p
  );
}

export function deletePostFromArray(posts: Post[], id: string): Post[] {
  return posts.filter((p) => p.id !== id);
}

export function bulkAddPostsToArray(posts: Post[], newPosts: Post[]): { posts: Post[]; added: number; skipped: number } {
  const existing = new Set(posts.map((p) => p.id));
  let added = 0;
  let skipped = 0;
  const result = [...posts];

  newPosts.forEach((item) => {
    if (existing.has(item.id)) { skipped++; return; }
    const isDuplicate = posts.some(
      (p) => p.platform === item.platform && p.date === item.date && p.sourceId === item.sourceId
    );
    if (isDuplicate) { skipped++; return; }
    const now = Date.now().toString();
    result.push({ ...item, id: generatePostId(), createdAt: now, updatedAt: now });
    existing.add(item.id);
    added++;
  });

  return { posts: result, added, skipped };
}

export function movePostInArray(posts: Post[], id: string, newDate: string): Post[] {
  return posts.map((p) => (p.id === id ? { ...p, date: newDate, updatedAt: Date.now().toString() } : p));
}

export function clearPostsArray(): Post[] {
  return [];
}

// ── LocalStorage Persistence ──

export function loadFromStorage(): Post[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : parsed?.posts || [];
      return arr.map(normalizePost);
    }
    const legacy = localStorage.getItem(LEGACY_STORE_KEY);
    if (legacy) {
      const legacyPosts = JSON.parse(legacy);
      const arr = Array.isArray(legacyPosts) ? legacyPosts : [];
      const normalized = arr.map(normalizePost);
      localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
      return normalized;
    }
  } catch {
    try { localStorage.removeItem(STORE_KEY); } catch {}
  }
  return [];
}

export function saveToStorage(posts: Post[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(posts));
  } catch {}
}

// ── DataLayer interface (for backward compatibility) ──

export interface DataLayer {
  getPosts(): Post[];
  addPost(post: Omit<Post, "id" | "createdAt" | "updatedAt">): string;
  updatePost(id: string, data: Partial<Post>): boolean;
  removePost(id: string): boolean;
  bulkAddPosts(posts: Post[]): { added: number; skipped: number };
  clearAll(): void;
}

// Backward-compatible bridge — mirrors whatever posts array is passed in.
// Components should use PostContext directly.
export function createDataLayer(getPosts: () => Post[], savePosts: (posts: Post[]) => void): DataLayer {
  return {
    getPosts() { return getPosts(); },
    addPost(post: Omit<Post, "id" | "createdAt" | "updatedAt">): string {
      const newPosts = addPostToArray(getPosts(), post);
      savePosts(newPosts);
      return newPosts[newPosts.length - 1].id;
    },
    updatePost(id: string, data: Partial<Post>): boolean {
      const newPosts = updatePostInArray(getPosts(), id, data);
      if (newPosts.length !== getPosts().length) { savePosts(newPosts); return true; }
      return false;
    },
    removePost(id: string): boolean {
      const newPosts = deletePostFromArray(getPosts(), id);
      if (newPosts.length !== getPosts().length) { savePosts(newPosts); return true; }
      return false;
    },
    bulkAddPosts(newPosts: Post[]): { added: number; skipped: number } {
      const result = bulkAddPostsToArray(getPosts(), newPosts);
      savePosts(result.posts);
      return result;
    },
    clearAll(): void {
      savePosts(clearPostsArray());
    },
  };
}

// ── Module-level bridge (backward compat for BulkImportModal) ──

let _cachedPosts: Post[] = loadFromStorage();

export const dataLayer: DataLayer = {
  getPosts() { return _cachedPosts; },
  addPost(post: Omit<Post, "id" | "createdAt" | "updatedAt">): string {
    const newPosts = addPostToArray(_cachedPosts, post);
    _cachedPosts = newPosts;
    saveToStorage(newPosts);
    return newPosts[newPosts.length - 1].id;
  },
  updatePost(id: string, data: Partial<Post>): boolean {
    const newPosts = updatePostInArray(_cachedPosts, id, data);
    if (newPosts.length !== _cachedPosts.length) {
      _cachedPosts = newPosts;
      saveToStorage(newPosts);
      return true;
    }
    return false;
  },
  removePost(id: string): boolean {
    const newPosts = deletePostFromArray(_cachedPosts, id);
    if (newPosts.length !== _cachedPosts.length) {
      _cachedPosts = newPosts;
      saveToStorage(newPosts);
      return true;
    }
    return false;
  },
  bulkAddPosts(newPosts: Post[]): { added: number; skipped: number } {
    const result = bulkAddPostsToArray(_cachedPosts, newPosts);
    _cachedPosts = result.posts;
    saveToStorage(_cachedPosts);
    return result;
  },
  clearAll(): void {
    _cachedPosts = [];
    saveToStorage([]);
  },
};
