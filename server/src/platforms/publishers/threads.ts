// server/src/platforms/publishers/threads.ts
// Real Threads publisher.
// Uses the Threads Graph API client to publish text, image, and video posts.
// The Threads client (src/lib/threads.ts) is completely isolated from the
// Facebook and Instagram clients — separate host, endpoints, tokens, and errors.
// Respects the existing scheduled_at scheduling semantics.
// Never logs the access token.

import type { Post } from "../../types";
import type { PlatformPublisher, PublishResult } from "./interface";
import { ThreadsGraphClient, type ThreadsMediaType } from "../../lib/threads";
import { logInfo, logError, logWarn } from "../../lib/logger";
import { getContentTypeCapability, validatePlatformPostCapability } from "../../platform-capabilities";

const PUBLISH_RETRY_DELAYS_MS = [5000, 10000, 20000] as const;

// ── Threads media_type mapping ──
function mapToThreadsMediaType(contentType: string | undefined): ThreadsMediaType {
  const capability = getContentTypeCapability("th", contentType);
  if (!capability) throw new Error(`Unsupported Threads content type: ${contentType || "(empty)"}`);
  return capability.backendType as ThreadsMediaType;
}

export class ThreadsPublisher implements PlatformPublisher {
  private client: ThreadsGraphClient;

  constructor(userId: string, accessToken: string) {
    this.client = new ThreadsGraphClient({ userId, accessToken });
  }

  async publish(post: Post): Promise<PublishResult> {
    logInfo(`Threads publish received`, { postId: post.id, platform: post.platform });

    const validation = validatePlatformPostCapability(post);
    if (validation.errors.length > 0) {
      const error = validation.errors.join(" ");
      logError("Threads publish validation failed", { postId: post.id, error });
      return { success: false, error };
    }

    const scheduledAt = post.scheduledAt;
    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();

    if (isScheduled) {
      logInfo(`Threads post ${post.id} is scheduled for ${scheduledAt} — not yet due`);
      return { success: false, error: "Post is scheduled and not yet due", isScheduled: true };
    }

    try {
      // Determine content type — map Social Planner contentType to Threads API media_type
      const threadsMediaType = mapToThreadsMediaType(post.contentType);
      const caption = post.caption || post.content || "";

      // Step 1: Create media container
      const containerResult = await this.client.createMediaContainer(
        caption,
        post.mediaUrl ?? undefined,
        threadsMediaType
      );

      if (!containerResult.success || !containerResult.containerId) {
        logError("Threads container creation failed", { error: containerResult.error });
        return { success: false, error: containerResult.error || "Container creation failed" };
      }

      logInfo(`Threads container created`, { containerId: containerResult.containerId });

      // Step 2: Publish the existing container. A newly created container may
      // not yet be visible to the publish endpoint; never recreate it on retry.
      const containerId = containerResult.containerId;
      let publishResult = await this.client.publishContainer(containerId);

      for (const [retryIndex, retryInMs] of PUBLISH_RETRY_DELAYS_MS.entries()) {
        if (publishResult.success || !publishResult.containerNotReady) break;

        logWarn("Threads container not ready; retrying publish", {
          postId: post.id,
          containerId,
          attempt: retryIndex + 1,
          retryInMs,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, retryInMs));
        publishResult = await this.client.publishContainer(containerId);
      }

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
