// server/src/metrics/interface.ts
// Metric provider interface for platform-specific metrics fetching.
// Part of Phase 1: Metrics Synchronization.

import type { Post } from "../types";

// ── Common metric fields extracted from platform APIs ──
export interface FetchedMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  platformMetrics?: Record<string, unknown>;
}

// ── Result returned by each provider ──
export interface MetricResult {
  success: boolean;
  platformPostId: string;
  postId: string;
  metrics?: FetchedMetrics;
  error?: string;
  // Platform-level failure (e.g. missing permissions) — different from a single post failing
  platformUnavailable?: boolean;
}

// ── Metric provider interface ──
// Each platform implements its own fetchMetrics logic.
export interface MetricProvider {
  // Whether this provider's platform supports metrics retrieval at all
  // (e.g. Threads may lack insights permissions)
  isAvailable(): boolean | Promise<boolean>;

  fetchMetrics(post: Post): Promise<MetricResult>;
}

// ── Sync report structure ──
export interface PlatformSyncResult {
  found: number;
  updated: number;
  failed: number;
  unavailable?: boolean;
  errors: string[];
}

export interface SyncReport {
  success: boolean;
  startedAt: string;
  completedAt: string;
  summary: {
    postsFound: number;
    postsUpdated: number;
    postsFailed: number;
  };
  platforms: {
    instagram?: PlatformSyncResult;
    threads?: PlatformSyncResult;
    youtube?: PlatformSyncResult;
    facebook?: PlatformSyncResult;
  };
  errors: string[];
}
