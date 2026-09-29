// server/src/metrics/providers/youtube.ts
// YouTube metrics provider.
// Uses the YouTube Data API v3 to fetch video statistics via
// GET /youtube/v3/videos?part=statistics&id={videoId}.
//
// Authentication: Uses the existing OAuth2 refresh token flow (same as the
// YouTube publishing client in lib/youtube.ts). Public statistics (viewCount,
// likeCount, commentCount) are available via the standard YouTube Data API v3
// with the existing OAuth token.
//
// YouTube has no "shares" metric in the Data API — shares will be 0 by default.
// No historical analytics are fetched in this phase (would require Analytics API
// with youtube.analytics.readonly scope).
//
// Part of Phase 1: Metrics Synchronization.

import type { Post } from "../../types";
import type { MetricProvider, MetricResult, FetchedMetrics } from "../interface";
import { logInfo, logError } from "../../lib/logger";
import { OAuth2Client } from "google-auth-library";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

// ── Map YouTube Data API v3 statistic names to our common field names ──
function mapYouTubeStats(stats: any): FetchedMetrics {
  const result: FetchedMetrics = {};

  if (stats.viewCount != null) {
    result.views = typeof stats.viewCount === "number" ? stats.viewCount : Number(stats.viewCount);
  }
  if (stats.likeCount != null) {
    result.likes = typeof stats.likeCount === "number" ? stats.likeCount : Number(stats.likeCount);
  }
  if (stats.commentCount != null) {
    result.comments = typeof stats.commentCount === "number" ? stats.commentCount : Number(stats.commentCount);
  }
  // YouTube Data API v3 does NOT have a shares metric.
  // shares remains undefined/0 — we never fabricate a value.

  return result;
}

// ── Get a fresh access token from the refresh token ──
// Uses the same OAuth2 flow as the YouTube publishing client.
// Reads env vars at call time (not module load) so dotenv has loaded .env first.
async function getYouTubeAccessToken(): Promise<string> {
  const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || "";
  const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || "";
  const YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN || "";
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    throw new Error("YouTube OAuth credentials not configured (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN)");
  }

  const oauth2Client = new OAuth2Client({
    clientId: YOUTUBE_CLIENT_ID,
    clientSecret: YOUTUBE_CLIENT_SECRET,
    redirectUri: "http://localhost:8080/",
  });

  oauth2Client.setCredentials({
    refresh_token: YOUTUBE_REFRESH_TOKEN,
  });

  const result = await oauth2Client.refreshAccessToken();
  const accessToken = result.credentials.access_token;

  if (!accessToken) {
    throw new Error("Failed to refresh YouTube access token");
  }

  return accessToken;
}

export class YouTubeMetricsProvider implements MetricProvider {
  constructor() {
    // YouTube provider uses the shared OAuth credentials from environment.
    // No per-post configuration needed.
  }

  isAvailable(): boolean {
    // Availability depends on whether the OAuth credentials are configured
    // and valid. We test by attempting a real call.
    return true;
  }

  async fetchMetrics(post: Post): Promise<MetricResult> {
    const { platformPostId, id } = post;

    if (!platformPostId) {
      return {
        success: false,
        platformPostId: "",
        postId: id,
        error: "No platformPostId (YouTube video ID) available for metrics",
      };
    }

    logInfo(`YouTube metrics fetch`, { postId: id, videoId: platformPostId });

    try {
      const accessToken = await getYouTubeAccessToken();

      // GET /youtube/v3/videos?part=statistics&id={videoId}&key={accessToken}
      // Using OAuth access token (not API key) since we already have OAuth set up.
      const url = `${YOUTUBE_API_BASE}/videos?part=statistics&id=${encodeURIComponent(platformPostId)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logError(`YouTube Data API error`, {
          postId: id,
          videoId: platformPostId,
          status: response.status,
        });
        return {
          success: false,
          platformPostId,
          postId: id,
          error: `YouTube API error ${response.status}: ${errorBody.slice(0, 300)}`,
        };
      }

      const data = await response.json();

      // The videos.list endpoint returns { items: [...] }
      if (!data.items || data.items.length === 0) {
        logError(`YouTube video not found`, {
          postId: id,
          videoId: platformPostId,
        });
        return {
          success: false,
          platformPostId,
          postId: id,
          error: `YouTube video not found: ${platformPostId}`,
        };
      }

      const stats = data.items[0].statistics;

      if (!stats) {
        logError(`YouTube video has no statistics`, {
          postId: id,
          videoId: platformPostId,
        });
        return {
          success: false,
          platformPostId,
          postId: id,
          error: `YouTube video statistics unavailable for video ${platformPostId}`,
        };
      }

      const mapped = mapYouTubeStats(stats);

      logInfo(`YouTube metrics fetched`, {
        postId: id,
        videoId: platformPostId,
        views: mapped.views,
        likes: mapped.likes,
        comments: mapped.comments,
        shares: "N/A (YouTube Data API does not expose shares)",
      });

      return {
        success: true,
        platformPostId,
        postId: id,
        metrics: mapped,
      };
    } catch (err: any) {
      // Detect OAuth scope issues
      const errMsg = err.message || String(err);
      const isScopeError =
        errMsg.includes("insufficient_scope") ||
        errMsg.includes("HTTPS") && errMsg.includes("403") ||
        errMsg.toLowerCase().includes("quota") ||
        errMsg.toLowerCase().includes("unauthorized");

      if (isScopeError && errMsg.includes("OAuth")) {
        logError(`YouTube OAuth scope issue for metrics`, {
          postId: post.id,
          error: errMsg.slice(0, 200),
        });
        return {
          success: false,
          platformPostId: post.platformPostId ?? "",
          postId: post.id,
          error: `YouTube metrics unavailable (OAuth issue): ${errMsg.slice(0, 200)}`,
          platformUnavailable: true,
        };
      }

      logError(`YouTube metrics fetch exception`, {
        postId: post.id,
        platformPostId,
        error: errMsg,
      });
      return {
        success: false,
        platformPostId: post.platformPostId ?? "",
        postId: post.id,
        error: errMsg || "YouTube metrics fetch failed",
      };
    }
  }
}
