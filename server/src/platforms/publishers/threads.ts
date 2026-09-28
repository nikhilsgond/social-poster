// server/src/platforms/publishers/threads.ts
// Real Threads publisher.
// Uses the Threads Graph API client to publish text, image, and video posts.
// Respects the existing scheduled_at scheduling semantics.
// Never logs the access token.

import type { Post } from "../../types";
import type { PlatformPublisher, PublishResult } from "./interface";
import { ThreadsGraphClient } from "../../lib/threads";
import { logInfo, logError } from "../../lib/logger";

export class ThreadsPublisher implements PlatformPublisher {
  private client: ThreadsGraphClient;

  constructor(userId: string, accessToken: string) {
    this.client = new ThreadsGraphClient({ userId, accessToken });
  }

  async publish(post: Post): Promise<PublishResult> {
    logInfo(`Threads publish received`, { postId: post.id, platform: post.platform });

    // Validate required fields
    if (!post.content && !post.mediaUrl) {
      logError("Threads publish failed: no content or media URL");
      return { success: false, error: "No content or media URL provided" };
    }

    const scheduledAt = post.scheduledAt;
    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();

    if (isScheduled) {
      logInfo(`Threads post ${post.id} is scheduled for ${scheduledAt} — not yet due`);
      return { success: false, error: "Post is scheduled and not yet due", isScheduled: true };
    }

    try {
      // Determine content type
      const contentType = post.contentType || "TEXT";
      const caption = post.caption || post.content || "";

      // Step 1: Create media container
      const containerResult = await this.client.createMediaContainer(
        caption,
        post.mediaUrl ?? undefined,
        contentType
      );

      if (!containerResult.success || !containerResult.containerId) {
        logError("Threads container creation failed", { error: containerResult.error });
        return { success: false, error: containerResult.error || "Container creation failed" };
      }

      logInfo(`Threads container created`, { containerId: containerResult.containerId });

      // Step 2: Publish the container
      const publishResult = await this.client.publishContainer(containerResult.containerId);

      if (publishResult.success) {
        logInfo(`Threads publish successful`, {
          postId: post.id,
          platformPostId: publishResult.postId,
          permalink: publishResult.permalink,
        });
      } else {
        logError(`Threads publish failed`, { postId: post.id, error: publishResult.error });
      }

      return {
        success: publishResult.success,
        platformPostId: publishResult.postId ?? null,
        socialUrl: publishResult.permalink ?? null,
        error: publishResult.error ?? null,
      };
    } catch (err: any) {
      logError(`Threads publish exception`, { postId: post.id, error: err.message });
      return { success: false, error: err.message || "Threads publish failed" };
    }
  }
}

// ── Singleton ──

let threadsInstance: ThreadsPublisher | null = null;

export function getThreadsPublisher(
  userId?: string,
  accessToken?: string
): ThreadsPublisher {
  if (!threadsInstance && userId && accessToken) {
    threadsInstance = new ThreadsPublisher(userId, accessToken);
  }
  if (!threadsInstance) {
    throw new Error(
      "Threads publisher not configured. Provide userId and accessToken."
    );
  }
  return threadsInstance;
}

export function resetThreadsInstance(): void {
  threadsInstance = null;
}
