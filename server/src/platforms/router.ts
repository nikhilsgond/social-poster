// server/src/platforms/router.ts
// Platform router: selects the correct publisher based on post.platform.
// For Phase 6+: Facebook publisher is fully implemented.
// YouTube, Threads, Instagram remain future integrations.

import type { Post } from "../types";
import type { PlatformPublisher, PublishResult } from "./publishers/interface";
import { getFacebookPublisher } from "./publishers/facebook";
import { getThreadsPublisher } from "./publishers/threads";
import { logWarn, logError } from "../lib/logger";

// Facebook credentials from server environment (read dynamically at runtime)
function getFacebookPageId(): string {
  return process.env.META_PAGE_ID || "";
}
function getFacebookPageToken(): string {
  return process.env.META_PAGE_ACCESS_TOKEN || "";
}

// Threads credentials from server environment (read dynamically at runtime)
function getThreadsUserId(): string {
  return process.env.THREADS_USER_ID || "";
}
function getThreadsAccessToken(): string {
  return process.env.THREAD_ACCESS_TOKEN || "";
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
    case "yt":
    case "ig":
    case "li":
    case "x":
      return null; // Future integrations
    default:
      return null;
  }
}