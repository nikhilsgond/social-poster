import type { Post } from "../types";

export type MetricsSyncPlatform = "ig" | "th" | "fb" | "yt";

export interface FetchedMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  platformMetrics?: Record<string, unknown>;
}

export interface MetricsSyncScope {
  startDate: string;
  endDateExclusive: string;
  startTime: string;
  endTimeExclusive: string;
  timeZone: string;
  platform?: MetricsSyncPlatform;
}

export interface DiscoveredPost {
  platform: MetricsSyncPlatform;
  platformPostId: string;
  publishedAt: string;
  contentType: string;
  title?: string;
  content?: string;
  description?: string;
  caption?: string;
  mediaUrl?: string;
  permalink?: string;
  metrics?: FetchedMetrics;
  /** True when discovery already returned every metric supported by this provider. */
  metricsComplete?: boolean;
}

export interface DiscoveryResult {
  success: boolean;
  posts: DiscoveredPost[];
  platformUnavailable?: boolean;
  error?: string;
}

export interface MetricResult {
  success: boolean;
  platformPostId: string;
  postId: string;
  metrics?: FetchedMetrics;
  error?: string;
  platformUnavailable?: boolean;
}

export interface MetricProvider {
  isAvailable(): boolean | Promise<boolean>;
  discoverPosts(scope: MetricsSyncScope): Promise<DiscoveryResult>;
  fetchMetrics(post: Post, knownMetrics?: FetchedMetrics): Promise<MetricResult>;
}

export interface PlatformSyncResult {
  discovered: number;
  added: number;
  existing: number;
  updated: number;
  failed: number;
  snapshotFailures: number;
  unavailable?: boolean;
  errors: string[];
}

export interface SyncReport {
  success: boolean;
  startedAt: string;
  completedAt: string;
  summary: {
    discovered: number;
    added: number;
    existing: number;
    updated: number;
    failed: number;
    snapshotFailures: number;
  };
  platforms: Partial<Record<MetricsSyncPlatform, PlatformSyncResult>>;
  errors: string[];
}
