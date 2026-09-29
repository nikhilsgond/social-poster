// server/src/metrics/providers/facebook.ts
// Facebook metrics provider.
// Uses the Facebook Graph API (graph.facebook.com, v26.0) to fetch Page post
// insights via GET /{page-post-id}/insights.
//
// Authentication: Uses the existing Page Access Token (META_PAGE_ACCESS_TOKEN)
// with read_insights + pages_read_engagement permissions.
//
// Mapping:
//   post_reactions_like_total         → likes
//   post_impressions                  → views (note: impressions deprecated in v25+,
//                                        replaced by views for new Page Experience)
//   post_story_shares                 → shares
//   Comments retrieved separately via GET /{post-id}?fields=comments
//
// Facebook-specific metrics (reactions breakdown, engaged_users, video metrics,
// click metrics) are stored in platformMetrics JSONB.
//
// IMPORTANT: Some Page Insights metrics are deprecated as of June 15, 2026
// (impressions → replaced by views; page_fans deprecated). We use post-level
// metrics only, not deprecated page-level metrics.
//
// Part of Phase 1: Metrics Synchronization.

import type { Post } from "../../types";
import type { MetricProvider, MetricResult, FetchedMetrics } from "../interface";
import { logInfo, logError } from "../../lib/logger";

const FB_BASE_URL = "https://graph.facebook.com/v26.0";

// ── Metrics we fetch from the Page Post Insights endpoint ──
// These are post-level metrics, not deprecated page-level metrics.
const FB_INSIGHT_METRICS = [
  "post_reactions_like_total",
  "post_reactions_love_total",
  "post_reactions_wow_total",
  "post_reactions_haha_total",
  "post_reactions_sad_total",
  "post_reactions_angry_total",
  "post_reactions_thankful_total",
  "post_reactions_care_total",
  "post_impressions",
  "post_impressions_unique",
  "post_story_shares",
  "post_engaged_users",
  "post_clicks",
  "post_negative_feedback",
];

// ── Video-specific metrics (only applicable to video posts) ──
const FB_VIDEO_METRICS = [
  "post_video_views",
  "post_video_unique_views",
  "post_video_avg_time_watched_actions",
  "post_video_complete_views",
  "post_video_view_time",
];

// ── Map Facebook API metric names to our common field names ──
function mapFacebookMetrics(
  data: any[],
  contentType: string | undefined
): FetchedMetrics {
  const result: FetchedMetrics = {};
  const platformMetrics: Record<string, unknown> = {};

  for (const item of data) {
    const name = item.name;
    const value = item.values?.[0]?.value;

    if (value === undefined || value === null) continue;

    const numValue = typeof value === "number" ? value : Number(value);

    switch (name) {
      case "post_reactions_like_total":
        result.likes = numValue;
        break;
      case "post_impressions":
        // Note: post_impressions is deprecated in v25+ but still works for post-level.
        // For new Page Experience, post_views is preferred but may not be available.
        // We map impressions to views as a fallback, and also store impressions separately.
        result.views = numValue;
        platformMetrics.postImpressions = numValue;
        break;
      case "post_impressions_unique":
        platformMetrics.postImpressionsUnique = numValue;
        break;
      case "post_story_shares":
        result.shares = numValue;
        break;
      case "post_engaged_users":
        platformMetrics.engagedUsers = numValue;
        break;
      case "post_clicks":
        platformMetrics.clicks = numValue;
        break;
      case "post_negative_feedback":
        platformMetrics.negativeFeedback = numValue;
        break;
      // Reaction breakdowns
      case "post_reactions_love_total":
        platformMetrics.reactionsLove = numValue;
        break;
      case "post_reactions_wow_total":
        platformMetrics.reactionsWow = numValue;
        break;
      case "post_reactions_haha_total":
        platformMetrics.reactionsHaha = numValue;
        break;
      case "post_reactions_sad_total":
        platformMetrics.reactionsSad = numValue;
        break;
      case "post_reactions_angry_total":
        platformMetrics.reactionsAngry = numValue;
        break;
      case "post_reactions_thankful_total":
        platformMetrics.reactionsThankful = numValue;
        break;
      case "post_reactions_care_total":
        platformMetrics.reactionsCare = numValue;
        break;
      // Video metrics (if applicable)
      case "post_video_views":
        platformMetrics.videoViews = numValue;
        break;
      case "post_video_unique_views":
        platformMetrics.videoUniqueViews = numValue;
        break;
      case "post_video_avg_time_watched_actions":
        platformMetrics.videoAvgWatchTime = numValue;
        break;
      case "post_video_complete_views":
        platformMetrics.videoCompleteViews = numValue;
        break;
      case "post_video_view_time":
        platformMetrics.videoViewTime = numValue;
        break;
      default:
        platformMetrics[name] = numValue;
        break;
    }
  }

  // Also store the content type for context
  platformMetrics.contentType = contentType;

  if (Object.keys(platformMetrics).length > 0) {
    result.platformMetrics = platformMetrics;
  }

  return result;
}

function isFacebookVideoContentType(contentType: string | undefined): boolean {
  const upper = (contentType || "").toUpperCase();
  return upper.includes("VIDEO") || upper === "REEL";
}

export class FacebookMetricsProvider implements MetricProvider {
  private pageAccessToken: string;
  private pageId: string;

  constructor(pageAccessToken: string, pageId: string) {
    this.pageAccessToken = pageAccessToken;
    this.pageId = pageId;
  }

  isAvailable(): boolean {
    return true; // Availability determined by real API call
  }

  async fetchMetrics(post: Post): Promise<MetricResult> {
    const { platformPostId, id, contentType } = post;

    if (!platformPostId) {
      return {
        success: false,
        platformPostId: "",
        postId: id,
        error: "No platformPostId (Facebook page post ID) available for metrics",
      };
    }

    logInfo(`Facebook metrics fetch`, { postId: id, postIdFb: platformPostId });

    try {
      // Build the metrics list — include video metrics for video content types
      const metricsToFetch = [...FB_INSIGHT_METRICS];
      if (isFacebookVideoContentType(contentType)) {
        metricsToFetch.push(...FB_VIDEO_METRICS);
      }

      const metricParam = metricsToFetch.join(",");

      // GET /{page-post-id}/insights?metric=post_reactions_like_total,post_impressions,...
      const url = `${FB_BASE_URL}/${platformPostId}/insights?metric=${encodeURIComponent(metricParam)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      // Facebook Graph API uses access_token as query param
      // But some endpoints also accept it in the Authorization header.
      // We retry with access_token appended if the first attempt fails with 400.
      let fbResponse = response;
      let fbData = await response.json();

      // If we got a 400 "An active access token is required", retry with token
      if (response.status === 400 && fbData.error?.message?.includes("access token")) {
        logInfo(`Facebook metrics: retrying with access token in URL`, { postId: id });
        const retryUrl = `${url}&access_token=${encodeURIComponent(this.pageAccessToken)}`;
        fbResponse = await fetch(retryUrl, { method: "GET" });
        if (fbResponse.ok) {
          fbData = await fbResponse.json();
        }
      }

      if (!fbResponse.ok) {
        const errorBody = JSON.stringify(fbData.error ?? { message: "Unknown error" });
        logError(`Facebook Insights API error`, {
          postId: id,
          postIdFb: platformPostId,
          status: fbResponse.status,
        });
        return {
          success: false,
          platformPostId,
          postId: id,
          error: `Facebook Insights API error ${fbResponse.status}: ${errorBody.slice(0, 300)}`,
        };
      }

      // The insights endpoint returns { data: [...] }
      if (!fbData.data || fbData.data.length === 0) {
        logInfo(`Facebook post insights returned empty data set`, {
          postId: id,
          postIdFb: platformPostId,
          note: "This may happen for posts that don't support insights or have no activity yet.",
        });
        return {
          success: true,
          platformPostId,
          postId: id,
          metrics: {
            platformMetrics: {
              note: "No insights data available for this Facebook post. Existing metrics preserved.",
            },
          },
        };
      }

      const mapped = mapFacebookMetrics(fbData.data, contentType);

      // Try to fetch comment count separately if not already included
      // The insights endpoint may not include comment count for all post types
      let commentCount: number | undefined;

      try {
        const commentUrl = `${FB_BASE_URL}/${platformPostId}?fields=comments&access_token=${encodeURIComponent(this.pageAccessToken)}`;
        const commentResponse = await fetch(commentUrl, { method: "GET" });
        if (commentResponse.ok) {
          const commentData = await commentResponse.json();
          if (commentData.comments?.summary?.total_count != null) {
            commentCount = commentData.comments.summary.total_count;
          }
        }
      } catch {
        // Comment fetch is best-effort; don't fail the whole sync if it fails
        logInfo(`Facebook: could not fetch comment count for post ${id}`);
      }

      if (commentCount !== undefined) {
        mapped.comments = commentCount;
      }

      logInfo(`Facebook metrics fetched`, {
        postId: id,
        postIdFb: platformPostId,
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
      // Detect permission errors
      const errMsg = err.message || String(err);
      const errLower = errMsg.toLowerCase();
      const isPermissionError =
        errLower.includes("permission") ||
        errLower.includes("read_insights") ||
        errLower.includes("pages_read_engagement") ||
        errLower.includes("access token");

      if (isPermissionError) {
        logError(`Facebook insights permission issue`, {
          postId: post.id,
          error: errMsg.slice(0, 200),
        });
        return {
          success: false,
          platformPostId: post.platformPostId ?? "",
          postId: post.id,
          error: `Facebook insights unavailable: ${errMsg.slice(0, 200)}`,
          platformUnavailable: true,
        };
      }

      logError(`Facebook metrics fetch exception`, {
        postId: post.id,
        platformPostId,
        error: errMsg,
      });
      return {
        success: false,
        platformPostId: post.platformPostId ?? "",
        postId: post.id,
        error: errMsg || "Facebook metrics fetch failed",
      };
    }
  }
}
