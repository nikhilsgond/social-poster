// server/src/platforms/publishers/instagram.ts
// Real Instagram publisher.
// Uses the Instagram Graph API to publish image and video posts.
// Respects the existing scheduled_at scheduling semantics.
// Never logs the access token.

import type { Post } from "../../types";
import type { PlatformPublisher, PublishResult } from "./interface";
import { InstagramGraphClient } from "../../lib/instagram";
import { logInfo, logError } from "../../lib/logger";

export class InstagramPublisher implements PlatformPublisher {
  private client: InstagramGraphClient;

  constructor(userId: string, accessToken: string) {
    this.client = new InstagramGraphClient({ userId, accessToken });
  }

  async publish(post: Post): Promise<PublishResult> {
    logInfo(`Instagram publish received`, { postId: post.id, platform: post.platform });

    // Validate required fields — Instagram requires media (image or video)
    if (!post.mediaUrl && !post.content) {
      logError("Instagram publish failed: no content or media URL");
      return { success: false, error: "No content or media URL provided" };
    }

    const scheduledAt = post.scheduledAt;
    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();

    if (isScheduled) {
      logInfo(`Instagram post ${post.id} is scheduled for ${scheduledAt} — not yet due`);
      return { success: false, error: "Post is scheduled and not yet due", isScheduled: true };
    }

    try {
      // Determine content type
      const contentType = post.contentType || "IMAGE";
      const caption = post.caption || post.content || "";

      // Step 1: Create media container
      const containerResult = await this.client.createMediaContainer(
        caption,
        post.mediaUrl ?? undefined,
        contentType
      );

      if (!containerResult.success || !containerResult.containerId) {
        logError("Instagram container creation failed", { error: containerResult.error });
        return { success: false, error: containerResult.error || "Container creation failed" };
      }

      logInfo(`Instagram container created`, { containerId: containerResult.containerId });

      // Step 2: Publish the container
      const publishResult = await this.client.publishContainer(containerResult.containerId);

      if (publishResult.success) {
        logInfo(`Instagram publish successful`, {
          postId: post.id,
          platformPostId: publishResult.postId,
          permalink: publishResult.permalink,
        });
      } else {
        logError(`Instagram publish failed`, { postId: post.id, error: publishResult.error });
      }

      return {
        success: publishResult.success,
        platformPostId: publishResult.postId ?? null,
        socialUrl: publishResult.permalink ?? null,
        error: publishResult.error ?? null,
      };
    } catch (err: any) {
      logError(`Instagram publish exception`, { postId: post.id, error: err.message });
      return { success: false, error: err.message || "Instagram publish failed" };
    }
  }
}

// ── Singleton ──

let instagramInstance: InstagramPublisher | null = null;

export function getInstagramPublisher(
  userId?: string,
  accessToken?: string
): InstagramPublisher {
  if (!instagramInstance && userId && accessToken) {
    instagramInstance = new InstagramPublisher(userId, accessToken);
  }
  if (!instagramInstance) {
    throw new Error(
      "Instagram publisher not configured. Provide userId and accessToken."
    );
  }
  return instagramInstance;
}

export function resetInstagramInstance(): void {
  instagramInstance = null;
}
