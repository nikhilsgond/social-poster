import { OAuth2Client } from "google-auth-library";
import type { Post } from "../../types";
import type { DiscoveredPost, DiscoveryResult, FetchedMetrics, MetricProvider, MetricResult, MetricsSyncScope } from "../interface";
import { logError } from "../../lib/logger";
import { inScope, isOlderThanScope, looksLikePlatformAuthFailure, numberMetric, publicProviderError } from "./shared";

const API_BASE = "https://www.googleapis.com/youtube/v3";

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function isShort(duration: string | undefined): boolean {
  if (!duration) return false;
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return false;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) <= 60;
}

export class YouTubeMetricsProvider implements MetricProvider {
  private accessToken?: string;

  isAvailable(): boolean { return true; }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const clientId = process.env.YOUTUBE_CLIENT_ID || "";
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || "";
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || "";
    if (!clientId || !clientSecret || !refreshToken) throw new Error("YouTube credentials are not configured");
    const client = new OAuth2Client({ clientId, clientSecret, redirectUri: "http://localhost:8080/" });
    client.setCredentials({ refresh_token: refreshToken });
    const result = await client.refreshAccessToken();
    if (!result.credentials.access_token) throw new Error("YouTube authorization failed");
    this.accessToken = result.credentials.access_token;
    return this.accessToken;
  }

  private async request(path: string): Promise<any> {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${await this.getAccessToken()}` },
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(publicProviderError("YouTube")) as Error & { status?: number; body?: string };
      error.status = response.status;
      error.body = bodyText;
      throw error;
    }
    return JSON.parse(bodyText);
  }

  async discoverPosts(scope: MetricsSyncScope, onBatch?: (posts: DiscoveredPost[]) => Promise<void>): Promise<DiscoveryResult> {
    try {
      const channels = await this.request("/channels?part=contentDetails&mine=true");
      const uploadsId = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsId) return { success: false, posts: [], platformUnavailable: true, error: publicProviderError("YouTube") };

      let pageToken = "";
      let reachedOlder = false;
      const posts: DiscoveryResult["posts"] = [];
      do {
        const params = new URLSearchParams({ part: "snippet,contentDetails", playlistId: uploadsId, maxResults: "50" });
        if (pageToken) params.set("pageToken", pageToken);
        const page = await this.request(`/playlistItems?${params.toString()}`);
        const candidates: Array<{ id: string; publishedAt: string }> = [];
        for (const item of page.items || []) {
          const id = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
          const publishedAt = item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt;
          if (!id || !publishedAt) continue;
          if (isOlderThanScope(publishedAt, scope)) reachedOlder = true;
          if (inScope(publishedAt, scope)) candidates.push({ id, publishedAt });
        }
        const pagePosts: DiscoveredPost[] = [];
        for (const batch of chunks(candidates, 50)) {
          const detailsParams = new URLSearchParams({
            part: "snippet,statistics,status,contentDetails",
            id: batch.map((item) => item.id).join(","),
            maxResults: "50",
          });
          const response = await this.request(`/videos?${detailsParams.toString()}`);
          for (const item of response.items || []) {
            const fallback = candidates.find((candidate) => candidate.id === item.id);
            const publishedAt = item.snippet?.publishedAt || fallback?.publishedAt;
            if (!publishedAt || !inScope(publishedAt, scope) || item.status?.privacyStatus === "private") continue;
            const thumbnails = item.snippet?.thumbnails || {};
            const thumbnail = thumbnails.maxres?.url || thumbnails.standard?.url || thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url;
            pagePosts.push({
              platform: "yt",
              platformPostId: String(item.id),
              publishedAt: new Date(publishedAt).toISOString(),
              contentType: isShort(item.contentDetails?.duration) ? "Short" : "Video",
              title: item.snippet?.title || undefined,
              description: item.snippet?.description || undefined,
              mediaUrl: thumbnail || undefined,
              permalink: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`,
              metrics: {
                views: numberMetric(item.statistics?.viewCount),
                likes: numberMetric(item.statistics?.likeCount),
                comments: numberMetric(item.statistics?.commentCount),
              },
              metricsComplete: true,
            });
          }
        }
        if (onBatch && pagePosts.length) await onBatch(pagePosts);
        else posts.push(...pagePosts);
        pageToken = reachedOlder ? "" : page.nextPageToken || "";
      } while (pageToken);
      return { success: true, posts };
    } catch (err: any) {
      logError("YouTube discovery failed", { error: err.message });
      return {
        success: false,
        posts: [],
        platformUnavailable: looksLikePlatformAuthFailure(err.status || 0, err.body || err.message || ""),
        error: publicProviderError("YouTube"),
      };
    }
  }

  async fetchMetrics(post: Post, _knownMetrics?: FetchedMetrics): Promise<MetricResult> {
    const platformPostId = post.platformPostId || "";
    try {
      const params = new URLSearchParams({ part: "statistics", id: platformPostId });
      const item = (await this.request(`/videos?${params.toString()}`)).items?.[0];
      if (!item) return { success: false, platformPostId, postId: post.id, error: publicProviderError("YouTube") };
      return {
        success: true,
        platformPostId,
        postId: post.id,
        metrics: {
          views: numberMetric(item.statistics?.viewCount),
          likes: numberMetric(item.statistics?.likeCount),
          comments: numberMetric(item.statistics?.commentCount),
        },
      };
    } catch (err: any) {
      return {
        success: false,
        platformPostId,
        postId: post.id,
        platformUnavailable: looksLikePlatformAuthFailure(err.status || 0, err.body || err.message || ""),
        error: publicProviderError("YouTube"),
      };
    }
  }
}
