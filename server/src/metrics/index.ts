// server/src/metrics/index.ts
// Metrics module barrel export.
// Part of Phase 1: Metrics Synchronization.

export { SyncMetricsService } from "./sync.service";
export type {
  MetricProvider,
  MetricResult,
  FetchedMetrics,
  PlatformSyncResult,
  SyncReport,
} from "./interface";
export { InstagramMetricsProvider } from "./providers/instagram";
export { ThreadsMetricsProvider } from "./providers/threads";
export { YouTubeMetricsProvider } from "./providers/youtube";
export { FacebookMetricsProvider } from "./providers/facebook";
