// src/hooks/usePosts.ts
// Hook for consuming the central PostContext and deriving filtered/computed data.

import { useMemo } from "react";
import { usePostContext } from "../context/PostContext";
import type { Platform, Post } from "../types/post";
import { metricSummary, metricNumber, formatMetric, escapeHtml, prettyDateShort, relativeTime } from "../lib/metrics";

export function usePosts() {
  const { state, posts, dispatch, addPost, updatePost, deletePost, bulkAddPosts, movePost, clearPosts } = usePostContext();
  return {
    posts,
    selectedPosts: state.selectedPosts,
    editPostId: state.editPostId,
    dispatch,
    addPost,
    updatePost,
    deletePost,
    bulkAddPosts,
    movePost,
    clearPosts,
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
      const today = new Date().toISOString().slice(0, 10);
      filtered = filtered.filter((p) => {
        const postStatus = p.date < today ? "posted" : "scheduled";
        return postStatus === status;
      });
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

export function useMetrics(pool: Post[]) {
  return useMemo(() => {
    const summary = metricSummary(pool);
    return {
      summary,
      formatMetric,
      metricNumber: (key: string) => metricNumber(pool.length ? pool[0] : null, key),
      getPostMetric: (post: Post, key: string) => metricNumber(post, key),
    };
  }, [pool]);
}
