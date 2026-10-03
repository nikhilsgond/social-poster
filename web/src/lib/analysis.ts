import type { Post, Platform } from "../types/post";

export const ANALYSIS_PLATFORMS = ["ig", "fb", "th", "yt"] as const;
export const MIN_COHORT_SIZE = 5;
export type Metric = "views" | "likes" | "comments" | "shares";
export type Range = "7d" | "30d" | "90d" | "all" | "custom";
export type Sort = "views" | "engagement" | "shares" | "comments" | "index" | "newest" | "oldest";
export interface Filters { platform: Platform | "all"; contentType: string; range: Range; start: string; end: string; }
export function metric(post: Post, key: Metric): number | null {
  if (key === "shares" && post.platform === "yt") return null;
  const value = post[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function median(values: Array<number | null | undefined>): number | null {
  const sorted = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function publicationParts(timestamp: string, timeZone: string) {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) };
}
export function filterAnalysisPosts(posts: Post[], filters: Filters, timeZone: string, now = new Date()): Post[] {
  const today = publicationParts(now.toISOString(), timeZone).date;
  const startDate = new Date(`${today}T00:00:00Z`);
  const days = filters.range === "7d" ? 7 : filters.range === "90d" ? 90 : 30;
  startDate.setUTCDate(startDate.getUTCDate() - days + 1);
  const start = filters.range === "custom" ? filters.start : startDate.toISOString().slice(0, 10);
  const end = filters.range === "custom" ? filters.end : today;
  return posts.filter(post => {
    if (post.status !== "published" || !post.publishedAt || !Number.isFinite(Date.parse(post.publishedAt))) return false;
    if (!(ANALYSIS_PLATFORMS as readonly string[]).includes(post.platform)) return false;
    if (filters.platform !== "all" && post.platform !== filters.platform) return false;
    if (filters.contentType !== "all" && post.contentType !== filters.contentType) return false;
    if (filters.range === "all") return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return false;
    const date = publicationParts(post.publishedAt, timeZone).date;
    return date >= start && date <= end;
  });
}
export function engagement(post: Post): number | null {
  const available = (["likes", "comments", "shares"] as const).map(key => metric(post, key)).filter((v): v is number => v !== null);
  return available.length ? available.reduce((sum, v) => sum + v, 0) : null;
}
export function engagementRate(engagements: number | null, views: number | null): number | null {
  return engagements !== null && views !== null && views > 0 ? engagements / views * 100 : null;
}
export function summarize(posts: Post[]) {
  const sum = (values: Array<number | null>) => {
    const available = values.filter((v): v is number => v !== null);
    return { total: available.length ? available.reduce((s, v) => s + v, 0) : posts.length ? null : 0, available: available.length };
  };
  const views = sum(posts.map(p => metric(p, "views")));
  const likes = sum(posts.map(p => metric(p, "likes")));
  const comments = sum(posts.map(p => metric(p, "comments")));
  const shares = sum(posts.map(p => metric(p, "shares")));
  const engagements = sum(posts.map(engagement));
  const average = (s: ReturnType<typeof sum>) => s.total !== null && s.available ? s.total / s.available : null;
  return { count: posts.length, views, likes, comments, shares, engagements,
    avgViews: average(views), avgLikes: average(likes), avgComments: average(comments), avgShares: average(shares), avgEngagement: average(engagements),
    medianViews: median(posts.map(p => metric(p, "views"))), rate: engagementRate(engagements.total, views.total),
    partial: posts.some(p => (["likes", "comments", "shares"] as const).some(k => metric(p, k) === null)),
  };
}
export function cohortKey(post: Post) { return JSON.stringify([post.platform, post.contentType || "Other"]); }
export function cohorts(posts: Post[]) {
  const groups = new Map<string, Post[]>();
  posts.forEach(p => { const key = cohortKey(p); groups.set(key, [...(groups.get(key) || []), p]); });
  return [...groups.entries()].map(([key, pool]) => ({ key, platform: pool[0].platform, contentType: pool[0].contentType || "Other", ...summarize(pool) }));
}
export function performanceIndex(post: Post, cohort: ReturnType<typeof summarize> | undefined): number | null {
  const views = metric(post, "views");
  return views !== null && cohort && cohort.views.available >= MIN_COHORT_SIZE && cohort.medianViews !== null && cohort.medianViews > 0 ? views / cohort.medianViews : null;
}
export function compareNullable(a: number | null, b: number | null, descending = true): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return descending ? b - a : a - b;
}
export function sortPosts(posts: Post[], sort: Sort, indices: Map<string, number | null>): Post[] {
  const value = (p: Post): number | null => sort === "engagement" ? engagement(p) : sort === "index" ? indices.get(p.id) ?? null : sort === "newest" || sort === "oldest" ? Date.parse(p.publishedAt!) : metric(p, sort);
  return [...posts].sort((a, b) => compareNullable(value(a), value(b), sort !== "oldest") || a.id.localeCompare(b.id));
}
export interface ChartPoint { label: string; value: number | null; count?: number; }
export function timeline(posts: Post[], timeZone: string): { grouping: string; views: ChartPoint[]; engagement: ChartPoint[]; posts: ChartPoint[] } {
  const dates = posts.map(p => publicationParts(p.publishedAt!, timeZone).date).sort();
  if (!dates.length) return { grouping: "day", views: [], engagement: [], posts: [] };
  const span = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000;
  const grouping = span > 180 ? "month" : span > 45 ? "week" : "day";
  const bucket = (day: string) => {
    if (grouping === "month") return day.slice(0, 7);
    if (grouping === "day") return day;
    const date = new Date(day + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
  };
  const grouped = new Map<string, Post[]>();
  posts.forEach(p => { const k = bucket(publicationParts(p.publishedAt!, timeZone).date); grouped.set(k, [...(grouped.get(k) || []), p]); });
  const cursor = new Date(dates[0] + "T00:00:00Z");
  while (cursor.toISOString().slice(0, 10) <= dates[dates.length - 1]) {
    const key = bucket(cursor.toISOString().slice(0, 10));
    if (!grouped.has(key)) grouped.set(key, []);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const rows = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([label, pool]) => ({ label, summary: summarize(pool) }));
  return { grouping, views: rows.map(r => ({ label: r.label, value: r.summary.count ? r.summary.views.total : 0 })),
    engagement: rows.map(r => ({ label: r.label, value: r.summary.count ? r.summary.engagements.total : 0 })), posts: rows.map(r => ({ label: r.label, value: r.summary.count })) };
}
export function averageGroups(posts: Post[], group: (p: Post) => string): ChartPoint[] {
  const groups = new Map<string, Post[]>();
  posts.forEach(p => { const k = group(p); groups.set(k, [...(groups.get(k) || []), p]); });
  return [...groups].map(([label, pool]) => ({ label, value: summarize(pool).avgViews, count: pool.length }));
}
export function postPreview(post: Post) { return (post.title || post.content || post.caption || post.description || post.topic || "Untitled post").slice(0, 120); }
export function postUrl(post: Post): string | null {
  const raw = post.socialUrl || post.permalink;
  if (!raw) return null;
  try { const url = new URL(raw); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
