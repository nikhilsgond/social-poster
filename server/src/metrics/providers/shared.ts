import type { FetchedMetrics, MetricsSyncScope } from "../interface";

export function inScope(timestamp: string, scope: MetricsSyncScope): boolean {
  const value = Date.parse(timestamp);
  return Number.isFinite(value)
    && value >= Date.parse(scope.startTime)
    && value < Date.parse(scope.endTimeExclusive);
}

export function isOlderThanScope(timestamp: string, scope: MetricsSyncScope): boolean {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value < Date.parse(scope.startTime);
}

export function numberMetric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function mergeMetrics(base?: FetchedMetrics, latest?: FetchedMetrics): FetchedMetrics {
  return {
    views: latest?.views ?? base?.views,
    likes: latest?.likes ?? base?.likes,
    comments: latest?.comments ?? base?.comments,
    shares: latest?.shares ?? base?.shares,
    platformMetrics: {
      ...(base?.platformMetrics || {}),
      ...(latest?.platformMetrics || {}),
    },
  };
}

export function publicProviderError(platform: string): string {
  return `${platform} data could not be synchronized.`;
}

export function looksLikePlatformAuthFailure(status: number, body: string): boolean {
  const lower = body.toLowerCase();
  return status === 401 || status === 403
    || lower.includes("permission")
    || lower.includes("access token")
    || lower.includes("oauth")
    || lower.includes("scope");
}
