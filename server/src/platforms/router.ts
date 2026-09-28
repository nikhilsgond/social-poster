// server/src/platforms/router.ts
// Platform router: selects the correct publisher based on post.platform.
// For Phase 6+: Facebook publisher is fully implemented.
// Threads and Instagram are implemented for scheduled publishing.
// YouTube is implemented for video upload with publishAt scheduling.
// LinkedIn, X remain future integrations.

import type { Post } from "../types";
import type { PlatformPublisher, PublishResult } from "./publishers/interface";
import { getFacebookPublisher } from "./publishers/facebook";
import { getThreadsPublisher } from "./publishers/threads";
import { getInstagramPublisher } from "./publishers/instagram";
import { getYouTubePublisher } from "./publishers/youtube";
import { logWarn, logError } from "../lib/logger";

// Facebook credentials from server environment (read dynamically at runtime)
function getFacebookPageId(): string {
  return process.env.META_PAGE_ID || "";
}
function getFacebookPageToken(): string {
  return process.env.META_PAGE_ACCESS_TOKEN || "";
}

// Threads credentials from server environment (read dynamically at runtime)
// Threads uses its own API host (graph.threads.net)
function getThreadsUserId(): string {
  return process.env.THREADS_USER_ID || "";
}
function getThreadsAccessToken(): string {
  return process.env.THREAD_ACCESS_TOKEN || "";
}

// Instagram credentials from server environment (read dynamically at runtime)
function getInstagramUserId(): string {
  return process.env.IG_USER_ID || "";
}
function getInstagramAccessToken(): string {
  return process.env.IG_ACCESS_TOKEN || "";
}

export async function routePublisher(post: Post): Promise<PublishResult> {
  const publisher = selectPublisher(post.platform);

  if (!publisher) {
    logWarn(`No publisher available for platform: ${post.platform}`);
    return {
      success: false,
      error: `No publisher available for platform: ${post.platform}`,
      testMode: false,
    };
  }

  try {
    return await publisher.publish(post);
  } catch (err: any) {
    logError(`Publisher error for platform ${post.platform}:`, { error: err.message });
    return {
      success: false,
      error: err.message || "Publisher error",
      testMode: false,
    };
  }
}

function selectPublisher(platform: string): PlatformPublisher | null {
  switch (platform) {
    case "fb":
      const pageId = getFacebookPageId();
      const pageToken = getFacebookPageToken();
      if (pageId && pageToken) {
        return getFacebookPublisher(pageId, pageToken);
      }
      logWarn("Facebook credentials not configured in environment");
      return null;
    case "th":
      const threadsUserId = getThreadsUserId();
      const threadsToken = getThreadsAccessToken();
      if (threadsUserId && threadsToken) {
        return getThreadsPublisher(threadsUserId, threadsToken);
      }
      logWarn("Threads credentials not configured in environment");
      return null;
    case "ig":
      const igUserId = getInstagramUserId();
      const igToken = getInstagramAccessToken();
      if (igUserId && igToken) {
        return getInstagramPublisher(igUserId, igToken);
      }
      logWarn("Instagram credentials not configured in environment");
      return null;
    case "yt": {
      const youtubeUserId = process.env.YOUTUBE_USER_ID || "default";
      const youtubeToken = process.env.YOUTUBE_ACCESS_TOKEN || "";
      const youtubeRefreshToken = process.env.YOUTUBE_REFRESH_TOKEN || "";
      if (youtubeToken && youtubeRefreshToken) {
        return getYouTubePublisher(youtubeUserId, youtubeToken, youtubeRefreshToken);
      }
      logWarn("YouTube credentials not configured in environment");
      return null;
    }
    case "li":
    case "x":
      return null; // Future integrations
    default:
      return null;
  }
}