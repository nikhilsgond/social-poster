// src/hooks/usePosts.ts
// Hook for consuming the central PostContext and deriving filtered/computed data.

import { useState, useEffect, useMemo, useCallback } from "react";
import { usePostContext } from "../context/PostContext";
import type { Platform, Post, MetricSnapshot, DateRange } from "../types/post";
import { metricSummary, metricNumber, formatMetric, escapeHtml, prettyDateShort, relativeTime, filterPostsByDateRange, snapshotSummary, latestSnapshotsByPost, snapshotPlatformStats, enrichPostsWithSnapshots, latestSnapshot, formatTimestamp, DATE_RANGE_OPTIONS, } from "../lib/metrics";
import { computeDateRange } from "../lib/supabasePosts";
import { fetchSnapshots, fetchPostSnapshots } from "../lib/supabasePosts";
import type { DateRangeType } from "../types/post";

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

// ── Sorted top posts (multi-metric) ──
export function sortedTopPosts(pool: Post[], metric: string, count = 10): Post[] {
  return pool
    .slice()
    .sort((a, b) => metricNumber(b, metric) - metricNumber(a, metric))
    .slice(0, count);
}

// ── Date Range Hook ──
export function useDateRange(initialType: DateRangeType = "30d") {
  const [type, setType] = useState<DateRangeType>(initialType);
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  const range = useMemo(() => {
    if (type === "custom" && customStart && customEnd) {
      return computeDateRange("custom", customStart, customEnd);
    }
    // Always compute from current time so 7d/30d/90d stay relative
    const now = new Date();
    const days = type === "7d" ? 7 : type === "30d" ? 30 : type === "90d" ? 90 : 30;
    const end = new Date(now);
    const start = new Date(now.getTime() - days * 86400000);
    return {
      type,
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
    } as DateRange;
  }, [type, customStart, customEnd]);

  return { type, setType, customStart, customEnd, setCustomStart, setCustomEnd, range };
}

// ── Snapshots Hook ──
// Fetches post_metric_snapshots from Supabase, optionally filtered by date range on captured_at.
// Memoizes snapshots, latest-by-post map, summary, trend data, and platform stats.
export function useSnapshots(dateRange?: DateRange) {
  const [snapshots, setSnapshots] = useState<MetricSnapshot[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSnapshots(dateRange);
      setSnapshots(data);
    } catch (err: any) {
      setError(err.message || "Failed to load snapshots");
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const latestMap = useMemo(() => latestSnapshotsByPost(snapshots), [snapshots]);

  const summary = useMemo(() => snapshotSummary(snapshots), [snapshots]);

  const platformStats = useMemo(() => snapshotPlatformStats(snapshots), [snapshots]);

  return {
    snapshots,
    loading,
    error,
    reload: loadSnapshots,
    latestMap,
    summary,
    platformStats,
  };
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
    setLoading(true);
    setError(null);
    fetchPostSnapshots(postId)
      .then((data) => setSnapshots(data))
      .catch((err: any) => setError(err.message || "Failed to load snapshot history"))
      .finally(() => setLoading(false));
  }, [postId]);

  return { snapshots, loading, error };
}

// ── Enrich posts with snapshot latest data ──
export function useEnrichedPosts(snapshots: MetricSnapshot[]): { posts: Post[]; latestMap: Map<string, MetricSnapshot> } {
  const { posts } = usePostContext();
  const latestMap = useMemo(() => latestSnapshotsByPost(snapshots), [snapshots]);
  const enriched = useMemo(() => {
    return posts.map((p) => {
      const snap = latestMap.get(p.id);
      if (!snap) return p;
      return { ...p, shares: snap.shares };
    });
  }, [posts, latestMap]);
  return { posts: enriched, latestMap };
}
