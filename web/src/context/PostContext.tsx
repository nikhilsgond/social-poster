// src/context/PostContext.tsx
// Central React state for all post data.
// Uses useReducer for predictable state management.
// Persists to Supabase via the repository layer (supabasePosts.ts).
// Phase 4: Supabase is the source of truth.

import { createContext, useContext, useReducer, useEffect, useCallback, useRef, useState } from "react";
import {
  fetchPost,
  createPost,
  createPosts,
  updatePost,
  deletePost as supabaseDeletePost,
  movePost as supabaseMovePost,
  formatSupabaseError,
  type PostsRefreshScope,
} from "../lib/supabasePosts";
import { cachePostChanges, loadPostsWithCache, mergePosts, refreshScopedPosts } from "../lib/postsLoading";
import type { Post } from "../types/post";
import { useToast } from "../components/common/Toast";
import { NativeSubmissionError, submitNativePost } from "../lib/backend";

export type NewPost = Omit<Post, "id" | "createdAt" | "updatedAt">;

export interface AddPostDetailedResult {
  post: Post;
  nativeAttempted: boolean;
  nativeSucceeded: boolean;
  error?: string;
}

// ── Actions ──

export type PostAction =
  | { type: "ADD_POST"; payload: Post }
  | { type: "UPDATE_POST"; payload: Post }
  | { type: "DELETE_POST"; payload: string }
  | { type: "BULK_ADD_POSTS"; payload: Post[] }
  | { type: "MOVE_POST"; payload: { id: string; newDate: string } }
  | { type: "CLEAR_POSTS" }
  | { type: "SET_POSTS"; payload: Post[] }
  | { type: "MERGE_POSTS"; payload: Post[] }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SELECT_TOGGLE"; payload: string }
  | { type: "SET_SELECTED"; payload: Record<string, boolean> }
  | { type: "SET_EDIT_POST"; payload: string | null }
  | { type: "PUSH_SNAPSHOT" }
  | { type: "UNDO" }
  | { type: "REDO" };

// ── State ──

export interface PostState {
  posts: Post[];
  selectedPosts: Record<string, boolean>;
  editPostId: string | null;
  loading: boolean;
  error: string | null;
  history: Post[][];
  historyIndex: number;
}

// ── Context ──

interface PostContextType {
  state: PostState;
  posts: Post[];
  dispatch: React.Dispatch<PostAction>;
  addPost: (post: NewPost) => Promise<void>;
  addPostDetailed: (post: NewPost) => Promise<AddPostDetailedResult>;
  updatePost: (id: string, changes: Partial<Post>) => Promise<void>;
  deletePost: (id: string) => Promise<void>;
  bulkAddPosts: (posts: NewPost[]) => Promise<Post[]>;
  movePost: (id: string, newDate: string) => Promise<void>;
  refreshPosts: (scope?: PostsRefreshScope) => Promise<void>;
  rebuildPostsCache: () => Promise<void>;
  rebuildingPostsCache: boolean;
  clearPosts: () => void;
  toggleSelect: (id: string) => void;
  setSelectedPosts: (posts: Record<string, boolean>) => void;
  setEditPost: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const PostContext = createContext<PostContextType | null>(null);

// ── Reducer ──

function postReducer(state: PostState, action: PostAction): PostState {
  switch (action.type) {
    case "MERGE_POSTS":
      return { ...state, posts: mergePosts(state.posts, action.payload) };
    case "SET_POSTS":
      return {
        ...state,
        posts: action.payload,
        selectedPosts: Object.fromEntries(
          Object.entries(state.selectedPosts).filter(([id]) => action.payload.some((post) => post.id === id))
        ),
        loading: false,
      };

    case "ADD_POST":
      return { ...state, posts: [...state.posts, action.payload] };

    case "UPDATE_POST":
      return {
        ...state,
        posts: state.posts.map((p) => (p.id === action.payload.id ? action.payload : p)),
      };

    case "DELETE_POST": {
      const id = action.payload;
      return {
        ...state,
        posts: state.posts.filter((p) => p.id !== id),
        selectedPosts: Object.fromEntries(Object.entries(state.selectedPosts).filter(([k]) => k !== id)),
      };
    }

    case "BULK_ADD_POSTS": {
      const existing = new Set(state.posts.map((p) => p.id));
      const newPosts = action.payload.filter((p) => !existing.has(p.id));
      return { ...state, posts: [...state.posts, ...newPosts] };
    }

    case "MOVE_POST":
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.payload.id ? { ...p, date: action.payload.newDate } : p
        ),
      };

    case "CLEAR_POSTS":
      return { ...state, posts: [], selectedPosts: {} };

    case "SET_LOADING":
      return { ...state, loading: action.payload };

    case "SET_ERROR":
      return { ...state, error: action.payload };

    case "SELECT_TOGGLE": {
      const id = action.payload;
      return { ...state, selectedPosts: { ...state.selectedPosts, [id]: !state.selectedPosts[id] } };
    }

    case "SET_SELECTED":
      return { ...state, selectedPosts: action.payload };

    case "SET_EDIT_POST":
      return { ...state, editPostId: action.payload };

    case "PUSH_SNAPSHOT": {
      const trimmed = state.history.slice(0, state.historyIndex + 1);
      const next = [...trimmed, [...state.posts]];
      if (next.length > 100) return { ...state, history: next.slice(-100), historyIndex: 99 };
      return { ...state, history: next, historyIndex: state.historyIndex + 1 };
    }

    case "UNDO": {
      if (state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      return { ...state, posts: [...state.history[newIndex]], historyIndex: newIndex };
    }

    case "REDO": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      return { ...state, posts: [...state.history[newIndex]], historyIndex: newIndex };
    }

    default:
      return state;
  }
}

// ── Provider ──

export function PostProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const cacheWarningShown = useRef(false);
  const rebuilding = useRef(false);
  const [rebuildingPostsCache, setRebuildingPostsCache] = useState(false);
  const [state, dispatch] = useReducer(postReducer, {
    posts: [],
    selectedPosts: {},
    editPostId: null,
    loading: true,
    error: null,
    history: [[]],
    historyIndex: 0,
  });

  const warnCacheUnavailable = useCallback(() => {
    if (cacheWarningShown.current) return;
    cacheWarningShown.current = true;
    showToast("Posts cache unavailable", "Posts still load from Supabase. Use Rebuild Posts Cache to retry local storage.", "warning");
  }, [showToast]);

  const persistChanges = useCallback(async (posts: Post[], deletedId?: string) => {
    if (!await cachePostChanges(posts, deletedId)) warnCacheUnavailable();
  }, [warnCacheUnavailable]);

  const loadPosts = useCallback(async (showLoading: boolean, rebuild = false) => {
    if (showLoading) dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const loaded = await loadPostsWithCache(showLoading ? (cached) => dispatch({ type: "SET_POSTS", payload: cached }) : undefined, rebuild);
      // A failed live refresh must retain any active data already on screen.
      if (!loaded.error) dispatch({ type: "SET_POSTS", payload: loaded.posts });
      if (loaded.cacheUnavailable) warnCacheUnavailable();
      if (loaded.error) throw loaded.error;
    } catch (err: any) {
      dispatch({ type: "SET_ERROR", payload: formatSupabaseError(err) });
      if (showLoading) dispatch({ type: "SET_LOADING", payload: false });
      throw err;
    }
  }, [warnCacheUnavailable]);

  // Historical records render from IndexedDB; Supabase supplies live changes.
  useEffect(() => {
    loadPosts(true)
      .then(() => dispatch({ type: "PUSH_SNAPSHOT" }))
      .catch(() => undefined);
  }, [loadPosts]);

  const refreshPosts = useCallback(async (scope?: PostsRefreshScope) => {
    if (!scope) { await loadPosts(false); return; }
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const refreshed = await refreshScopedPosts(scope);
      dispatch({ type: "MERGE_POSTS", payload: refreshed.posts });
      if (refreshed.cacheUnavailable) warnCacheUnavailable();
    } catch (error) {
      dispatch({ type: "SET_ERROR", payload: formatSupabaseError(error) });
      throw error;
    }
  }, [loadPosts, warnCacheUnavailable]);

  const rebuildPostsCache = useCallback(async () => {
    if (rebuilding.current) return;
    rebuilding.current = true;
    setRebuildingPostsCache(true);
    cacheWarningShown.current = false;
    try {
      await loadPosts(false, true);
      if (!cacheWarningShown.current) showToast("Posts cache rebuilt", "Published history and live posts have been refreshed.", "success");
    } finally {
      rebuilding.current = false;
      setRebuildingPostsCache(false);
    }
  }, [loadPosts, showToast]);

  // Action wrappers — all go through Supabase
  const finalizeNativePost = useCallback(async (post: Post, notify = true): Promise<AddPostDetailedResult> => {
    if (post.status !== "scheduled" || (post.platform !== "fb" && post.platform !== "yt")) {
      return { post, nativeAttempted: false, nativeSucceeded: true };
    }
    try {
      return { post: await submitNativePost(post), nativeAttempted: true, nativeSucceeded: true };
    } catch (err: any) {
      // The backend owns the definitive status. Re-read it so an uncertain
      // browser/network response never overwrites platform IDs or lifecycle data.
      let refreshed = await fetchPost(post.id).catch(() => null);
      if (err instanceof NativeSubmissionError && err.canMarkFailed && refreshed?.status === "scheduled" && !refreshed.platformPostId) {
        refreshed = await updatePost(post.id, { status: "failed", errorMessage: err.message }).catch(() => refreshed);
      }
      const message = err?.message || "The backend did not accept the post.";
      if (notify) showToast("Native scheduling needs attention", message, "error");
      return { post: refreshed || post, nativeAttempted: true, nativeSucceeded: false, error: message };
    }
  }, [showToast]);

  const addPostDetailed = useCallback(async (postData: NewPost): Promise<AddPostDetailedResult> => {
    dispatch({ type: "PUSH_SNAPSHOT" });
    const newPost = await createPost(postData);
    const result = await finalizeNativePost(newPost, false);
    await persistChanges([result.post]);
    dispatch({ type: "ADD_POST", payload: result.post });
    return result;
  }, [finalizeNativePost, persistChanges]);

  const addPost = useCallback(async (postData: NewPost) => {
    try {
      const result = await addPostDetailed(postData);
      if (result.nativeSucceeded) showToast("Post added", "New post has been added.", "success");
      else showToast("Native scheduling needs attention", result.error || "The backend did not accept the post.", "error");
    } catch (err: any) {
      showToast("Error", formatSupabaseError(err), "error");
    }
  }, [addPostDetailed, showToast]);

  const updatePostFn = useCallback(async (id: string, changes: Partial<Post>) => {
    try {
      dispatch({ type: "PUSH_SNAPSHOT" });
      const updated = await updatePost(id, changes);
      if (updated) {
        await persistChanges([updated]);
        dispatch({ type: "UPDATE_POST", payload: updated });
        showToast("Post updated", "Post has been updated.", "success");
      }
    } catch (err: any) {
      showToast("Error", formatSupabaseError(err), "error");
    }
  }, [showToast, persistChanges]);

  const deletePostFn = useCallback(async (id: string) => {
    try {
      dispatch({ type: "PUSH_SNAPSHOT" });
      await supabaseDeletePost(id);
      await persistChanges([], id);
      dispatch({ type: "DELETE_POST", payload: id });
      showToast("Post deleted", "Post removed.", "info");
    } catch (err: any) {
      showToast("Error", formatSupabaseError(err), "error");
    }
  }, [showToast, persistChanges]);

  const bulkAddPostsFn = useCallback(async (posts: NewPost[]): Promise<Post[]> => {
    try {
      dispatch({ type: "PUSH_SNAPSHOT" });
      const created = await createPosts(posts);
      const finalized: Post[] = [];
      for (const post of created) {
        finalized.push((await finalizeNativePost(post)).post);
      }
      if (finalized.length) {
        await persistChanges(finalized);
        dispatch({ type: "BULK_ADD_POSTS", payload: finalized });
        showToast("Import complete", `${finalized.length} posts imported.`, "success");
      }
      return finalized;
    } catch (err: any) {
      showToast("Error", formatSupabaseError(err), "error");
      return [];
    }
  }, [finalizeNativePost, showToast, persistChanges]);

  const movePostFn = useCallback(async (id: string, newDate: string) => {
    try {
      dispatch({ type: "PUSH_SNAPSHOT" });
      const updated = await supabaseMovePost(id, newDate);
      if (updated) {
        await persistChanges([updated]);
        dispatch({ type: "UPDATE_POST", payload: updated });
        showToast("Post moved", `Post moved to ${newDate}.`, "success");
      }
    } catch (err: any) {
      showToast("Error", formatSupabaseError(err), "error");
    }
  }, [showToast, persistChanges]);

  const setEditPost = useCallback((id: string | null) => {
    dispatch({ type: "SET_EDIT_POST", payload: id });
  }, [dispatch]);

  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);
  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.history.length - 1;

  const toggleSelect = useCallback((id: string) => {
    dispatch({ type: "SELECT_TOGGLE", payload: id });
  }, [dispatch]);

  const setSelectedPosts = useCallback((posts: Record<string, boolean>) => {
    dispatch({ type: "SET_SELECTED", payload: posts });
  }, [dispatch]);

  return (
    <PostContext.Provider value={{
      state, posts: state.posts, dispatch,
      addPost, addPostDetailed, updatePost: updatePostFn, deletePost: deletePostFn,
      bulkAddPosts: bulkAddPostsFn, movePost: movePostFn, refreshPosts,
      rebuildPostsCache, rebuildingPostsCache,
      clearPosts: () => dispatch({ type: "CLEAR_POSTS" }),
      toggleSelect,
      setSelectedPosts,
      setEditPost,
      undo, redo, canUndo, canRedo,
    }}>
      {children}
    </PostContext.Provider>
  );
}

// ── Hook ──

export function usePostContext(): PostContextType {
  const ctx = useContext(PostContext);
  if (!ctx) throw new Error("usePostContext must be used within PostProvider");
  return ctx;
}
