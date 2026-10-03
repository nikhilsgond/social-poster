import type { FetchedMetrics } from "./interface";

// Undefined means a failed/omitted refresh: retain a known value.
// Null explicitly means the API does not supply the metric. Zero is a value.
export function currentMetrics(platform: string, latest: FetchedMetrics, previous: FetchedMetrics = {}): FetchedMetrics {
  const result: FetchedMetrics = {};
  for (const key of ["views", "likes", "comments", "shares"] as const) {
    result[key] = latest[key] !== undefined ? latest[key] : previous[key] ?? null;
  }
  if (platform === "yt") result.shares = null;
  return result;
}
