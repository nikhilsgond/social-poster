// server/src/platforms/publishers/facebook.ts
// Real Facebook publisher.
// Uses the Facebook Graph API client to publish text and images.
// Supports native Facebook scheduling.
// Never logs the Page Access Token.

import type { Post } from "../../types";
import type { PlatformPublisher, PublishResult } from "./interface";
import { FacebookGraphClient, toUnixTimestamp } from "../../lib/facebook";
import { logInfo, logError } from "../../lib/logger";
import { getContentTypeCapability, validatePlatformPostCapability } from "../../platform-capabilities";

export class FacebookPublisher implements PlatformPublisher {
  private client: FacebookGraphClient;

  constructor(pageId: string, pageAccessToken: string) {
    this.client = new FacebookGraphClient({ pageId, pageAccessToken });
  }

  async publish(post: Post): Promise<PublishResult> {
    logInfo(`Facebook publish received`, { postId: post.id, platform: post.platform });

    const validation = validatePlatformPostCapability(post);
    if (validation.errors.length > 0) {
      const error = validation.errors.join(" ");
      logError("Facebook publish validation failed", { postId: post.id, error });
      return { success: false, error };
    }
    const contentType = getContentTypeCapability("fb", validation.canonicalContentType)!;

    const scheduledAt = post.scheduledAt;
    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();
    let scheduledPublishTime: number | undefined;

    if (isScheduled && scheduledAt) {
      scheduledPublishTime = toUnixTimestamp(scheduledAt);
      logInfo(`Facebook scheduling post ${post.id} for ${scheduledAt}`, {
        scheduledPublishTime,
      });
    }

    try {
      let result: PublishResult;

      if (contentType.mediaType === "image") {
        // Image post
        result = await this.client.publishImage(
          post.mediaUrl!,
          post.caption || post.content || undefined,
          scheduledPublishTime
        );
      } else {
        // Text post
        result = await this.client.publishText(
          post.content || "",
          scheduledPublishTime
        );
      }

      if (result.success) {
        logInfo(`Facebook publish successful`, {
          postId: post.id,
          platformPostId: result.platformPostId,
          socialUrl: result.socialUrl,
          isScheduled: result.isScheduled,
        });
      } else {
        logError(`Facebook publish failed`, {
          postId: post.id,
          error: result.error,
        });
      }

      return result;
    } catch (err: any) {
      logError(`Facebook publish exception`, {
        postId: post.id,
        error: err.message,
      });
      return { success: false, error: err.message || "Facebook publish failed" };
    }
  }
}

// ── Singleton ──

let facebookInstance: FacebookPublisher | null = null;

export function getFacebookPublisher(
  pageId?: string,
  pageAccessToken?: string
): FacebookPublisher {
  if (!facebookInstance && pageId && pageAccessToken) {
    facebookInstance = new FacebookPublisher(pageId, pageAccessToken);
  }
  if (!facebookInstance) {
    throw new Error(
      "Facebook publisher not configured. Provide pageId and pageAccessToken."
    );
  }
  return facebookInstance;
}

export function resetFacebookInstance(): void {
  facebookInstance = null;
}
