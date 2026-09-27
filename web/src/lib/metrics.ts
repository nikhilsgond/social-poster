// src/lib/metrics.ts
// Pure metrics calculation functions derived from the centralized post dataset.
// These are pure functions — no state, no side effects.
// All UI components call these to derive metrics from posts.

import type { Post, Platform } from "../types/post";
import { platformDataMap } from "../components/common/PlatformIcon";

// ── Metric Helpers ──

export function metricNumber(post: Post | null, key: string): number {
  const v = post ? Number((post as any)[key]) : 0;
  return Number.isFinite(v) ? v : 0;
}

export interface MetricSummary {
  count: number;
  views: number;
  likes: number;
  comments: number;
  avgViews: number;
  engagement: number;
}

export function metricSummary(pool: Post[]): MetricSummary {
  let views = 0, likes = 0, comments = 0;
  pool.forEach((p) => {
    views += metricNumber(p, "views");
    likes += metricNumber(p, "likes");
    comments += metricNumber(p, "comments");
  });
  return {
    count: pool.length,
    views, likes, comments,
    avgViews: pool.length ? views / pool.length : 0,
    engagement: views ? ((likes + comments) / views) * 100 : 0,
  };
}

export function formatMetric(n: number): string {
  n = Number(n) || 0;
  const abs = Math.abs(n);
  if (abs >= 1000000) return (n / 1000000).toFixed(abs >= 10000000 ? 0 : 1) + "M";
  if (abs >= 1000) return (n / 1000).toFixed(abs >= 100000 ? 0 : 1) + "K";
  return Math.round(n).toLocaleString();
}

export function escapeHtml(str: string): string {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (c: string): string => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || ""));
}

// ── Platform-Level Metrics ──

export function platformStats(pool: Post[], platform: Platform) {
  const ps = pool.filter((p) => p.platform === platform);
  return metricSummary(ps);
}

// ── Content Type Chart Data ──

export function contentTypeChartData(pool: Post[]) {
  const counts: Record<string, number> = {};
  pool.forEach((p) => { const t = p.contentType || "Other"; counts[t] = (counts[t] || 0) + 1; });
  const items = Object.keys(counts).map((k) => ({ label: k, value: counts[k] })).sort((a, b) => b.value - a.value).slice(0, 8);
  return items;
}

// ── Views Trend Data ──

export function viewsTrendData(pool: Post[]) {
  const byDate: Record<string, number> = {};
  pool.forEach((p) => { const d = p.date; if (d && d !== "Unknown") byDate[d] = (byDate[d] || 0) + metricNumber(p, "views"); });
  const dates = Object.keys(byDate).sort();
  const vals = dates.map((d) => byDate[d]);
  return { dates, vals };
}

// ── Weekday Chart Data ──

export function weekdayChartData(pool: Post[]) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  pool.forEach((p) => {
    if (!p.date) return;
    const a = p.date.split("-");
    const d = new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
    const idx = (d.getDay() + 6) % 7;
    counts[idx]++;
  });
  return counts;
}

// ── Engagement by Content Type ──

export function engagementByType(pool: Post[]) {
  const engagementByType: Record<string, { views: number; likes: number; comments: number }> = {};
  pool.forEach((p) => {
    const t = p.contentType || "Other";
    if (!engagementByType[t]) engagementByType[t] = { views: 0, likes: 0, comments: 0 };
    engagementByType[t].views += metricNumber(p, "views");
    engagementByType[t].likes += metricNumber(p, "likes");
    engagementByType[t].comments += metricNumber(p, "comments");
  });
  return engagementByType;
}

// ── Top Posts ──

export function topPosts(pool: Post[], count = 5): Post[] {
  return pool.slice().sort((a, b) => metricNumber(b, "views") - metricNumber(a, "views")).slice(0, count);
}

// ── Platform Performance Stats ──

export function platformPerformance(pool: Post[]) {
  const stats = (["yt", "ig", "fb", "th", "li", "x"] as Platform[]).map((p) => {
    const ps = pool.filter((x) => x.platform === p);
    const s = metricSummary(ps);
    return { key: p, posts: s.count, views: s.views, engagement: s.engagement };
  });
  return stats;
}

// ── Performance Analysis ──

export function performanceAnalysis(pool: Post[], metric: string, dim: string) {
  if (!pool.length) return null;

  function val(p: Post) { const v = Number((p as any)[metric]); return Number.isFinite(v) ? v : 0; }
  function engagement(p: Post) { const v = Number((p as any).views || 0); return v ? ((Number((p as any).likes || 0) + Number((p as any).comments || 0)) / v * 100) : 0; }

  const groups: Record<string, Post[]> = {};
  pool.forEach((p) => {
    const k = dim === "contentType" ? (p.contentType || "Other") : (platformDataMap as any)[p.platform].name;
    if (!groups[k]) groups[k] = [];
    groups[k].push(p);
  });

  const rows = Object.keys(groups).map((k) => {
    const a = groups[k];
    const total = a.reduce((s, p) => s + val(p), 0);
    const er = a.reduce((s, p) => s + engagement(p), 0) / a.length;
    return { key: k, count: a.length, total, avg: total / a.length, eng: er };
  }).sort((a, b) => b.avg - a.avg);

  return { rows, best: rows[0], worst: rows[rows.length - 1] };
}

// ── Pretty Date Helper ──

export function prettyDateShort(dateStr: string): string {
  const parts = dateStr.split("-");
  const d = new Date(Number(parts[0]) || 0, Number(parts[1]) - 1 || 0, Number(parts[2]) || 0);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function relativeTime(ts: string | null | undefined): string {
  if (!ts) return "\u2014";
  const diff = Date.now() - Number(ts);
  const min = 60000, hr = 3600000, day = 86400000;
  if (diff < min) return "just now";
  if (diff < hr) return Math.floor(diff / min) + "m ago";
  if (diff < day) return Math.floor(diff / hr) + "h ago";
  if (diff < day * 30) return Math.floor(diff / day) + "d ago";
  return new Date(Number(ts)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
