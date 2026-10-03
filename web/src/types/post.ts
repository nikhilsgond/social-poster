export type Platform = "yt" | "ig" | "fb" | "th" | "li" | "x";

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

// ── Date Range ──
export type DateRangeType = "7d" | "30d" | "90d" | "custom";

export interface DateRange {
  type: DateRangeType;
  startDate: string;  // ISO date string YYYY-MM-DD
  endDate: string;    // ISO date string YYYY-MM-DD
}

// ── Historical Metric Snapshot (from post_metric_snapshots table) ──
export interface MetricSnapshot {
  id: string;
  postId: string;
  platform: Platform;
  capturedAt: string;      // ISO timestamp from captured_at
  views: number;
  likes: number;
  comments: number;
  shares: number;
  platformMetrics: Record<string, any> | null;  // JSONB from platform_metrics
}

export type Post = {
  id: string;
  platform: Platform;
  contentType: string;
  title?: string;
  topic?: string;
  content?: string;
  description?: string;
  caption?: string;
  date: string;
  time: string;
  scheduledAt?: string;
  mediaUrl?: string | null;
  mediaUrls?: string[] | null;
  cloudinaryPublicId?: string | null;
  socialUrl?: string | null;
  mediaCleanedAt?: string | null;
  status: PostStatus;
  platformPostId?: string | null;
  errorMessage?: string | null;
  attempts?: number;
  publishedAt?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;        // Current metric on posts
  metricsUpdatedAt?: string | null;
  sourceId?: string | null;
  permalink?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

// ── Status Helpers ──
export function getStatusLabel(status: PostStatus | undefined): string {
  switch (status) {
    case "draft": return "Draft";
    case "scheduled": return "Scheduled";
    case "publishing": return "Publishing";
    case "published": return "Published";
    case "failed": return "Failed";
    default: return "Unknown";
  }
}

export function getStatusClass(status: PostStatus | undefined): string {
  switch (status) {
    case "draft": return "status-draft";
    case "scheduled": return "status-scheduled";
    case "publishing": return "status-publishing";
    case "published": return "status-published";
    case "failed": return "status-failed";
    default: return "status-scheduled";
  }
}

export const STATUS_OPTIONS: { value: PostStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "publishing", label: "Publishing" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Failed" },
];
