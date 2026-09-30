// server/src/metrics/providers/instagram.ts
// Instagram metrics provider.
// Uses the existing Instagram Graph API client (graph.instagram.com) to fetch
// media insights via GET /{media-id}/insights.
// Part of Phase 1: Metrics Synchronization.

import type { Post } from "../../types";
import type { MetricProvider, MetricResult, FetchedMetrics, MetricsSyncScope, DiscoveryResult } from "../interface";
import { logInfo, logError } from "../../lib/logger";
import { inScope, isOlderThanScope, looksLikePlatformAuthFailure, numberMetric, publicProviderError } from "./shared";

// ── Instagram Graph API host (same as the publishing client) ──
const IG_BASE_URL = "https://graph.instagram.com/v26.0";

// ── Metrics we attempt to fetch for all Instagram media types ──
const COMMON_METRICS = [
  "likes",
  "comments",
  "shares",
  "saved",
  "reach",
  "total_interactions",
  "views",
];

// ── Additional metrics for Reels ──
const REEL_METRICS = [
  "ig_reels_video_view_total_time",
  "ig_reels_avg_watch_time",
];

// ── Additional metrics for Stories ──
// Stories insights are only available for 24 hours after posting.
// If the story is older, the API returns an empty data set (not an error).
const STORY_METRICS = [
  "impressions",
  "reach",
  "taps_forward",
  "taps_back",
  "exits",
  "replies",
];

// ── Map Instagram API metric names to our common field names ──
function mapInstagramMetrics(data: any[]): FetchedMetrics {
  const result: FetchedMetrics = {};

  for (const item of data) {
    const name = item.name;
    const value = item.values?.[0]?.value;

    if (value === undefined || value === null) continue;

    switch (name) {
      case "likes":
        result.likes = typeof value === "number" ? value : Number(value);
        break;
      case "comments":
        result.comments = typeof value === "number" ? value : Number(value);
        break;
      case "shares":
        result.shares = typeof value === "number" ? value : Number(value);
        break;
      case "views":
        result.views = typeof value === "number" ? value : Number(value);
        break;
      case "saved":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.saved = typeof value === "number" ? value : Number(value);
        break;
      case "reach":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.reach = typeof value === "number" ? value : Number(value);
        break;
      case "impressions":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.impressions = typeof value === "number" ? value : Number(value);
        break;
      case "plays":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.plays = typeof value === "number" ? value : Number(value);
        break;
      case "total_interactions":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.totalInteractions = typeof value === "number" ? value : Number(value);
        break;
      case "ig_reels_video_view_total_time":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.reelsVideoViewTotalTime =
          typeof value === "number" ? value : Number(value);
        break;
      case "ig_reels_avg_watch_time":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.reelsAvgWatchTime =
          typeof value === "number" ? value : Number(value);
        break;
      case "ig_reels_replays_count":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.replaysCount =
          typeof value === "number" ? value : Number(value);
        break;
      case "ig_reels_aggregated_all_plays_count":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.aggregatedAllPlaysCount =
          typeof value === "number" ? value : Number(value);
        break;
      case "taps_forward":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.tapsForward =
          typeof value === "number" ? value : Number(value);
        break;
      case "taps_back":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.tapsBack = typeof value === "number" ? value : Number(value);
        break;
      case "exits":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.exits = typeof value === "number" ? value : Number(value);
        break;
      case "replies":
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics.replies = typeof value === "number" ? value : Number(value);
        break;
      default:
        // Store unknown metrics in platformMetrics for forward compatibility
        result.platformMetrics = result.platformMetrics || {};
        result.platformMetrics[name] = typeof value === "number" ? value : Number(value);
        break;
    }
  }

  return result;
}

function isStoryContentType(contentType: string | undefined): boolean {
  const upper = (contentType || "").toUpperCase();
  return upper === "STORY" || upper === "STORYIMAGE" || upper === "STORYVIDEO";
}

function isReelContentType(contentType: string | undefined): boolean {
  const upper = (contentType || "").toUpperCase();
  return upper === "REEL" || upper === "REELS";
}

export class InstagramMetricsProvider implements MetricProvider {
  private accessToken: string;
  private userId: string;

  constructor(accessToken: string, userId: string) {
    this.accessToken = accessToken;
    this.userId = userId;
  }

  // Instagram insights are available if the access token is valid.
  // The same token used for publishing should work for insights if it has
  // instagram_business_basic permission. We determine availability by
  // attempting a real call — if it returns 200 with data, we're good.
  isAvailable(): boolean {
    return true; // We test by making a real call in fetchMetrics
  }

  async discoverPosts(scope: MetricsSyncScope): Promise<DiscoveryResult> {
    const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
    const params = new URLSearchParams({
      fields,
      limit: "100",
      since: String(Math.floor(Date.parse(scope.startTime) / 1000)),
      until: String(Math.floor(Date.parse(scope.endTimeExclusive) / 1000)),
    });
    let nextUrl: string | undefined = `${IG_BASE_URL}/${encodeURIComponent(this.userId)}/media?${params.toString()}`;
    const posts: DiscoveryResult["posts"] = [];

    try {
      while (nextUrl) {
        const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${this.accessToken}` } });
        const bodyText = await response.text();
        if (!response.ok) {
          return {
            success: false,
            posts,
            platformUnavailable: looksLikePlatformAuthFailure(response.status, bodyText),
            error: publicProviderError("Instagram"),
          };
        }
        const body = JSON.parse(bodyText);
        const page = Array.isArray(body.data) ? body.data : [];
        let reachedOlder = false;
        for (const item of page) {
          if (!item.id || !item.timestamp) continue;
          if (isOlderThanScope(item.timestamp, scope)) reachedOlder = true;
          if (!inScope(item.timestamp, scope)) continue;
          const mediaType = String(item.media_product_type || item.media_type || "POST").toUpperCase();
          posts.push({
            platform: "ig",
            platformPostId: String(item.id),
            publishedAt: new Date(item.timestamp).toISOString(),
            contentType: mediaType === "REELS" ? "Reel" : mediaType === "CAROUSEL_ALBUM" ? "Carousel" : mediaType === "STORY" ? "Story" : "Post",
            caption: item.caption || undefined,
            mediaUrl: item.thumbnail_url || item.media_url || undefined,
            permalink: item.permalink || undefined,
            metrics: {
              likes: numberMetric(item.like_count),
              comments: numberMetric(item.comments_count),
            },
          });
        }
        nextUrl = reachedOlder ? undefined : body.paging?.next;
      }
      return { success: true, posts };
    } catch (err: any) {
      logError("Instagram discovery failed", { error: err.message });
      return { success: false, posts, error: publicProviderError("Instagram") };
    }
  }

  async fetchMetrics(post: Post, knownMetrics?: FetchedMetrics): Promise<MetricResult> {
    const { platformPostId, id, contentType } = post;

    if (!platformPostId) {
      return {
        success: false,
        platformPostId: "",
        postId: id,
        error: "No platformPostId available for Instagram metrics",
      };
    }

    logInfo(`Instagram metrics fetch`, { postId: id, mediaId: platformPostId });

    try {
      // Build the metrics list based on content type
      const metricsToFetch = COMMON_METRICS.filter((metric) =>
        !(metric === "likes" && knownMetrics?.likes !== undefined)
        && !(metric === "comments" && knownMetrics?.comments !== undefined)
      );

      if (isReelContentType(contentType)) {
        metricsToFetch.push(...REEL_METRICS);
      } else if (isStoryContentType(contentType)) {
        metricsToFetch.push(...STORY_METRICS);
      }

      const metricParam = metricsToFetch.join(",");

      // GET /{media-id}/insights?metric=likes,comments,shares,...
      const url = `${IG_BASE_URL}/${platformPostId}/insights?metric=${encodeURIComponent(metricParam)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logError(`Instagram insights API error`, {
          postId: id,
          mediaId: platformPostId,
          status: response.status,
        });
        return {
          success: false,
          platformPostId,
          postId: id,
          error: `Instagram API error ${response.status}: ${errorBody}`,
        };
      }

      const data = await response.json();

      // The insights endpoint returns { data: [...] } where each item has
      // name, period, values[], title, description, id.
      // If the media doesn't support a requested metric, that metric is
      // simply absent from the response (not an error).
      if (!data.data || data.data.length === 0) {
        logInfo(`Instagram insights returned empty data set`, {
          postId: id,
          mediaId: platformPostId,
          note: "This can happen for unsupported metrics or restricted content. Returning current metrics unchanged.",
        });
        // Return success with no new metrics — we don't want to zero out
        // existing metrics just because some aren't available
        return {
          success: true,
          platformPostId,
          postId: id,
          metrics: {
            platformMetrics: {
              note: "No insights data available for this media. Existing metrics preserved.",
            },
          },
        };
      }

      const mapped = mapInstagramMetrics(data.data);

      logInfo(`Instagram metrics fetched`, {
        postId: id,
        mediaId: platformPostId,
        views: mapped.views,
        likes: mapped.likes,
        comments: mapped.comments,
        shares: mapped.shares,
        extraMetrics: Object.keys(mapped.platformMetrics || {}).length,
      });

      return {
        success: true,
        platformPostId,
        postId: id,
        metrics: mapped,
      };
    } catch (err: any) {
      logError(`Instagram metrics fetch exception`, {
        postId: post.id,
        platformPostId,
        error: err.message,
      });
      return {
        success: false,
        platformPostId,
        postId: post.id,
        error: err.message || "Instagram metrics fetch failed",
      };
    }
  }
}
