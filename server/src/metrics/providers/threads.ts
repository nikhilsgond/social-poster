// server/src/metrics/providers/threads.ts
// Threads metrics provider.
// Uses the Threads Graph API (graph.threads.net) to fetch post insights via
// GET /{threads-media-id}/insights.
//
// IMPORTANT: The threads_manage_insights scope is required for the insights
// endpoint and is currently in beta (pending Meta App Review). If the existing
// THREAD_ACCESS_TOKEN does not have this scope, the provider will return a
// structured platform-level failure without breaking the overall sync.
//
// Threads publishing (threads_basic + threads_content_publish) is NOT affected
// by this — publishing continues to work normally.
//
// Part of Phase 1: Metrics Synchronization.

import type { Post } from "../../types";
import type { MetricProvider, MetricResult, FetchedMetrics } from "../interface";
import { logInfo, logError } from "../../lib/logger";

const TH_BASE_URL = "https://graph.threads.net/v1.0";

// ── Available Threads metrics (as of API v1.0) ──
// Source: https://developers.facebook.com/docs/threads/reference/insights
const THREADS_METRICS = [
  "views",
  "likes",
  "replies",
  "reposts",
  "quotes",
  "shares",
];

// ── Map Threads API metric names to our common field names ──
function mapThreadsMetrics(data: any[]): FetchedMetrics {
  const result: FetchedMetrics = {};

  for (const item of data) {
    const name = item.name;
    const value = item.values?.[0]?.value;

    if (value === undefined || value === null) continue;

    const numValue = typeof value === "number" ? value : Number(value);

    switch (name) {
      case "views":
        result.views = numValue;
        break;
      case "likes":
        result.likes = numValue;
        break;
      case "replies":
        // "replies" on Threads is the closest equivalent to "comments"
        result.comments = numValue;
        break;
      case "reposts":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.reposts = numValue;
        break;
      case "quotes":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.quotes = numValue;
        break;
      case "shares":
        result.shares = numValue;
        break;
      default:
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics[name] = numValue;
        break;
    }
  }

  return result;
}

export class ThreadsMetricsProvider implements MetricProvider {
  private accessToken: string;
  private userId: string;

  constructor(accessToken: string, userId: string) {
    this.accessToken = accessToken;
    this.userId = userId;
  }

  // Threads insights require the threads_manage_insights scope, which is
  // currently in beta and may not be granted. We determine availability
  // by attempting a real call — if it returns a permissions error, the
  // platform is marked as unavailable but the overall sync continues.
  isAvailable(): boolean {
    return true; // Availability is determined at runtime in fetchMetrics
  }

  async fetchMetrics(post: Post): Promise<MetricResult> {
    const { platformPostId, id } = post;

    if (!platformPostId) {
      return {
        success: false,
        platformPostId: "",
        postId: id,
        error: "No platformPostId available for Threads metrics",
      };
    }

    logInfo(`Threads metrics fetch`, { postId: id, mediaId: platformPostId });

    try {
      const metricParam = THREADS_METRICS.join(",");

      // Threads API uses access_token as a query parameter (same as publishing)
      const params = new URLSearchParams({
        access_token: this.accessToken,
        metric: metricParam,
      });
      const insightUrl = `${TH_BASE_URL}/${platformPostId}/insights?${params.toString()}`;

      const insightResponse = await fetch(insightUrl, {
        method: "GET",
      });

      if (!insightResponse.ok) {
        const errorText = await insightResponse.text();

        // Detect permission errors — Threads insights require threads_manage_insights scope
        const errLower = errorText.toLowerCase();
        if (errLower.includes("permission") || errLower.includes("scope") || errLower.includes("threads_manage_insights")) {
          logError(`Threads insights permission denied`, {
            postId: id,
            mediaId: platformPostId,
            error: errorText.slice(0, 200),
          });
          return {
            success: false,
            platformPostId,
            postId: id,
            error: `Threads insights permission denied: ${errorText.slice(0, 200)}`,
            platformUnavailable: true,
          };
        }

        // HTTP error (4xx, 5xx)
        logError(`Threads insights API error`, {
          postId: id,
          mediaId: platformPostId,
          status: insightResponse.status,
        });
        return {
          success: false,
          platformPostId,
          postId: id,
          error: `Threads API error ${insightResponse.status}: ${errorText.slice(0, 200)}`,
        };
      }

      const data = await insightResponse.json();

      // The insights endpoint returns { data: [...] }
      if (!data.data || data.data.length === 0) {
        logInfo(`Threads insights returned empty data set`, {
          postId: id,
          mediaId: platformPostId,
          note: "Metrics may not be available for this post yet, or the post type may not support insights.",
        });
        return {
          success: true,
          platformPostId,
          postId: id,
          metrics: {
            platformMetrics: {
              note: "No insights data available for this Threads post. Existing metrics preserved.",
            },
          },
        };
      }

      const mapped = mapThreadsMetrics(data.data);

      logInfo(`Threads metrics fetched`, {
        postId: id,
        mediaId: platformPostId,
        views: mapped.views,
        likes: mapped.likes,
        comments: mapped.comments,
        shares: mapped.shares,
      });

      return {
        success: true,
        platformPostId,
        postId: id,
        metrics: mapped,
      };
    } catch (err: any) {
      // If the error message contains "Permission" or "permission", it's
      // likely a threads_manage_insights scope issue
      const errMsg = err.message || String(err);
      const errLower = errMsg.toLowerCase();
      const isPermissionError =
        errLower.includes("permission") ||
        errLower.includes("scope") ||
        errLower.includes("threads_manage_insights");

      if (isPermissionError) {
        logError(`Threads insights permission unavailable`, {
          postId: post.id,
          error: errMsg.slice(0, 200),
        });
        return {
          success: false,
          platformPostId: post.platformPostId ?? "",
          postId: post.id,
          error: `Threads insights unavailable: ${errMsg.slice(0, 200)}`,
          platformUnavailable: true,
        };
      }

      logError(`Threads metrics fetch exception`, {
        postId: post.id,
        platformPostId,
        error: errMsg,
      });
      return {
        success: false,
        platformPostId: post.platformPostId ?? "",
        postId: post.id,
        error: errMsg || "Threads metrics fetch failed",
      };
    }
  }
}
