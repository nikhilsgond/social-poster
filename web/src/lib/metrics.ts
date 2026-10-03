import type { Post, MetricSnapshot } from "../types/post";

export function metricNumber(post: Post | null, key: string): number {
  const v = post ? Number((post as any)[key]) : 0;
  return Number.isFinite(v) ? v : 0;
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

export function latestSnapshotsByPost(snapshots: MetricSnapshot[]): Map<string, MetricSnapshot> {
  const map = new Map<string, MetricSnapshot>();
  snapshots.forEach((s) => {
    const existing = map.get(s.postId);
    if (!existing || new Date(s.capturedAt) > new Date(existing.capturedAt)) {
      map.set(s.postId, s);
    }
  });
  return map;
}

export function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "\u2014";
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// Retained for the unrelated post detail modal.
export function latestSnapshot(snapshots: MetricSnapshot[]): MetricSnapshot | null {
  return snapshots.reduce<MetricSnapshot | null>((latest, snapshot) =>
    !latest || Date.parse(snapshot.capturedAt) > Date.parse(latest.capturedAt) ? snapshot : latest, null);
}
