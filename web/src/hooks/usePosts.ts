// src/hooks/usePosts.ts
// Hook for consuming the central PostContext and deriving filtered/computed data.

import { useState, useEffect, useMemo } from "react";
import { usePostContext } from "../context/PostContext";
import type { Platform, Post, MetricSnapshot } from "../types/post";
import { metricNumber } from "../lib/metrics";
import { fetchPostSnapshots } from "../lib/supabasePosts";

export function usePosts() {
  const { state, posts, dispatch, addPost, updatePost, deletePost, bulkAddPosts, movePost, clearPosts, setEditPost } = usePostContext();
  return {
    posts,
    selectedPosts: state.selectedPosts,
    editPostId: state.editPostId,
    loading: state.loading,
    error: state.error,
    dispatch,
    addPost,
    updatePost,
    deletePost,
    bulkAddPosts,
    movePost,
    clearPosts,
    setEditPost,
    postCount: posts.length,
  };
}
export function useFilteredPosts(
  posts: Post[],
  platform: Platform | "all",
  contentType: string,
  status: string,
  search: string,
  sort: string,
  sortDir: string
) {
  return useMemo(() => {
    let filtered = posts;

    if (platform !== "all") {
      filtered = filtered.filter((p) => p.platform === platform);
    }
    if (contentType !== "all") {
      filtered = filtered.filter((p) => (p.contentType || "") === contentType);
    }
    if (status !== "all") {
      filtered = filtered.filter((p) => p.status === status);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((p) => {
        const haystack = [p.platform, p.contentType || "", p.title || "", p.topic || "", p.content || "", p.caption || ""].join(" ").toLowerCase();
        return haystack.indexOf(q) !== -1;
      });
    }

    return filtered.sort((a, b) => {
      const dir = sortDir === "desc" ? -1 : 1;
      if (sort === "views" || sort === "likes" || sort === "comments") {
        return (metricNumber(a, sort) - metricNumber(b, sort)) * dir;
      }
      if (sort === "platform") return a.platform.localeCompare(b.platform) * dir;
      if (sort === "contentType") return (a.contentType || "").localeCompare(b.contentType || "") * dir;
      return ((a.date || "") + " " + (a.time || "99:99")).localeCompare((b.date || "") + " " + (b.time || "99:99")) * dir;
    });
  }, [posts, platform, contentType, status, search, sort, sortDir]);
}

// ── Individual Post Snapshots Hook ──
export function usePostSnapshots(postId: string | null) {
  const [snapshots, setSnapshots] = useState<MetricSnapshot[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!postId) {
      setSnapshots([]);
      return;
    }
    let cancelled = false;
    setSnapshots([]);
    setLoading(true);
    setError(null);
    fetchPostSnapshots(postId)
      .then((data) => { if (!cancelled) setSnapshots(data); })
      .catch((err: any) => { if (!cancelled) setError(err.message || "Failed to load snapshot history"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [postId]);

  return { snapshots, loading, error };
}
