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
import type { MetricProvider, MetricResult, FetchedMetrics, MetricsSyncScope, DiscoveryResult, DiscoveredPost } from "../interface";
import { logInfo, logError } from "../../lib/logger";
import { inScope, isOlderThanScope, looksLikePlatformAuthFailure, numberMetric, publicProviderError } from "./shared";

const FB_BASE_URL = "https://graph.facebook.com/v26.0";

// ── Metrics we fetch from the Page Post Insights endpoint ──
// These are post-level metrics, not deprecated page-level metrics.
const FB_INSIGHT_METRICS = [
  "post_media_view",
];

// ── Video-specific metrics (only applicable to video posts) ──
const FB_VIDEO_METRICS: string[] = [];

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
      case "post_media_view":
        result.views = numValue;
        platformMetrics.mediaViews = numValue;
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

interface FacebookAttachment {
  type?: unknown;
  media_type?: unknown;
  media?: unknown;
  url?: unknown;
  subattachments?: { data?: unknown[] };
}

interface FacebookDiscoveryItem {
  message?: unknown;
  full_picture?: unknown;
  attachments?: { data?: unknown[] };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function usableUrl(value: unknown): string | undefined {
  const url = stringValue(value);
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function mediaObject(attachment: FacebookAttachment): Record<string, any> {
  return attachment.media && typeof attachment.media === "object"
    ? attachment.media as Record<string, any>
    : {};
}

function flattenFacebookAttachments(data: unknown[] | undefined): FacebookAttachment[] {
  const flattened: FacebookAttachment[] = [];
  for (const value of data || []) {
    if (!value || typeof value !== "object") continue;
    const attachment = value as FacebookAttachment;
    flattened.push(attachment);
    flattened.push(...flattenFacebookAttachments(attachment.subattachments?.data));
  }
  return flattened;
}

function attachmentMetadata(attachment: FacebookAttachment): string {
  const media = mediaObject(attachment);
  return [attachment.type, attachment.media_type, media.type, media.media_type]
    .map(stringValue)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isReelAttachment(attachment: FacebookAttachment): boolean {
  const metadata = attachmentMetadata(attachment);
  const url = stringValue(attachment.url);
  const source = stringValue(mediaObject(attachment).source);
  return /(?:^|[^a-z])reels?(?:[^a-z]|$)/i.test(metadata) || /\/(?:reel|reels)\//i.test(`${url} ${source}`);
}

function isVideoAttachment(attachment: FacebookAttachment): boolean {
  const media = mediaObject(attachment);
  const metadata = attachmentMetadata(attachment);
  const url = stringValue(attachment.url);
  const source = stringValue(media.source);
  return /(?:^|[^a-z])video(?:[^a-z]|$)/i.test(metadata)
    || Boolean(source)
    || /\/(?:video|videos)\//i.test(url)
    || /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(url);
}

function isImageAttachment(attachment: FacebookAttachment): boolean {
  const media = mediaObject(attachment);
  const metadata = attachmentMetadata(attachment);
  const mediaString = stringValue(attachment.media);
  const url = stringValue(attachment.url);
  return /(?:^|[^a-z])(?:photo|image|picture)(?:[^a-z]|$)/i.test(metadata)
    || Boolean(usableUrl(media.image?.src))
    || /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(`${mediaString} ${url}`);
}

export function classifyFacebookContentType(item: FacebookDiscoveryItem): "Reel" | "Video" | "Multiple Images" | "Image" | "Text" {
  const attachments = flattenFacebookAttachments(item.attachments?.data);
  if (attachments.some(isReelAttachment)) return "Reel";
  if (attachments.some(isVideoAttachment)) return "Video";

  const imageCount = attachments.filter((attachment) =>
    !(attachment.subattachments?.data?.length) && isImageAttachment(attachment)
  ).length;
  if (imageCount >= 2) return "Multiple Images";
  if (imageCount === 1 || usableUrl(item.full_picture)) return "Image";
  return "Text";
}

function facebookMediaUrl(item: FacebookDiscoveryItem): string | undefined {
  const fullPicture = usableUrl(item.full_picture);
  if (fullPicture) return fullPicture;

  for (const attachment of flattenFacebookAttachments(item.attachments?.data)) {
    const media = mediaObject(attachment);
    const candidate = usableUrl(media.image?.src)
      || usableUrl(media.source)
      || usableUrl(attachment.media)
      || usableUrl(attachment.url);
    if (candidate) return candidate;
  }
  return undefined;
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

  async discoverPosts(scope: MetricsSyncScope, onBatch?: (posts: DiscoveredPost[]) => Promise<void>): Promise<DiscoveryResult> {
    const params = new URLSearchParams({
      fields: "id,message,created_time,permalink_url,full_picture,attachments{media_type,type,media,url,subattachments{media_type,type,media,url}},shares,comments.limit(0).summary(true),reactions.type(LIKE).limit(0).summary(true)",
      limit: "100",
      access_token: this.pageAccessToken,
    });
    if (!scope.allHistory) {
      params.set("since", String(Math.floor(Date.parse(scope.startTime) / 1000)));
      params.set("until", String(Math.floor(Date.parse(scope.endTimeExclusive) / 1000)));
    }
    let nextUrl: string | undefined = `${FB_BASE_URL}/${encodeURIComponent(this.pageId)}/posts?${params.toString()}`;
    const posts: DiscoveryResult["posts"] = [];
    try {
      while (nextUrl) {
        const response = await fetch(nextUrl);
        const bodyText = await response.text();
        if (!response.ok) {
          return {
            success: false,
            posts,
            platformUnavailable: looksLikePlatformAuthFailure(response.status, bodyText),
            error: publicProviderError("Facebook"),
          };
        }
        const body = JSON.parse(bodyText);
        const page = Array.isArray(body.data) ? body.data : [];
        let reachedOlder = false;
        const pagePosts: DiscoveredPost[] = [];
        for (const item of page) {
          if (!item.id || !item.created_time) continue;
          if (isOlderThanScope(item.created_time, scope)) reachedOlder = true;
          if (!inScope(item.created_time, scope)) continue;
          pagePosts.push({
            platform: "fb",
            platformPostId: String(item.id),
            publishedAt: new Date(item.created_time).toISOString(),
            contentType: classifyFacebookContentType(item),
            content: item.message || undefined,
            mediaUrl: facebookMediaUrl(item),
            permalink: item.permalink_url || undefined,
            metrics: {
              likes: numberMetric(item.reactions?.summary?.total_count),
              comments: numberMetric(item.comments?.summary?.total_count),
              shares: numberMetric(item.shares?.count),
            },
          });
        }
        if (onBatch && pagePosts.length) await onBatch(pagePosts);
        else posts.push(...pagePosts);
        nextUrl = reachedOlder ? undefined : body.paging?.next;
      }
      return { success: true, posts };
    } catch (err: any) {
      logError("Facebook discovery failed", { error: err.message });
      return { success: false, posts, error: publicProviderError("Facebook") };
    }
  }

  async fetchMetrics(post: Post, knownMetrics?: FetchedMetrics): Promise<MetricResult> {
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
      const metricsToFetch = FB_INSIGHT_METRICS.filter((metric) =>
        !(metric === "post_reactions_like_total" && knownMetrics?.likes !== undefined)
        && !(metric === "post_story_shares" && knownMetrics?.shares !== undefined)
      );
      if (isFacebookVideoContentType(contentType)) {
        metricsToFetch.push(...FB_VIDEO_METRICS);
      }

      const metricParam = metricsToFetch.join(",");

      // GET /{page-post-id}/insights?metric=post_reactions_like_total,post_impressions,...
      const url = `${FB_BASE_URL}/${platformPostId}/insights?metric=${encodeURIComponent(metricParam)}&access_token=${encodeURIComponent(this.pageAccessToken)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const fbResponse = response;
      const fbData = await response.json();

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
        if (knownMetrics?.comments !== undefined) {
          commentCount = knownMetrics.comments;
        } else {
        const commentUrl = `${FB_BASE_URL}/${platformPostId}?fields=comments&access_token=${encodeURIComponent(this.pageAccessToken)}`;
        const commentResponse = await fetch(commentUrl, { method: "GET" });
        if (commentResponse.ok) {
          const commentData = await commentResponse.json();
          if (commentData.comments?.summary?.total_count != null) {
            commentCount = commentData.comments.summary.total_count;
          }
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
