// server/src/platforms/publishers/instagram.ts
// Real Instagram publisher.
// Uses the Instagram Graph API client to publish image and video posts.
// The Instagram client (src/lib/instagram.ts) is completely isolated from the
// Threads client (src/lib/threads.ts) and Facebook client (src/lib/facebook.ts).
// Separate host, endpoints, parameters, tokens, and error types.
// Respects the existing scheduled_at scheduling semantics.
// Never logs the access token.

import type { Post } from "../../types";
import type { PlatformPublisher, PublishResult } from "./interface";
import { InstagramGraphClient } from "../../lib/instagram";
import { logInfo, logWarn, logError } from "../../lib/logger";

// ── Instagram media_type mapping ──
// Social Planner uses internal content types (e.g. "Other", "Text", "Image").
// Instagram API requires: IMAGE, VIDEO, CAROUSEL_ALBUM.
// This mapping validates and converts the planner type to the Instagram API type.
// Unknown types default to IMAGE since Instagram requires media.

function mapToInstagramMediaType(contentType: string | undefined): string {
  const upper = (contentType || "").toUpperCase();
  switch (upper) {
    case "IMAGE":
    case "VIDEO":
    case "CAROUSEL_ALBUM":
    case "CAROUSEL":
      return upper === "CAROUSEL" ? "CAROUSEL_ALBUM" : upper;
    case "OTHER":
    case "TEXT":
    case "":
      logWarn(`Instagram: unknown contentType "${contentType}" — defaulting to media_type=IMAGE`);
      return "IMAGE";
    default:
      logWarn(`Instagram: unsupported contentType "${contentType}" — defaulting to media_type=IMAGE`);
      return "IMAGE";
  }
}

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
      // Determine content type — map Social Planner contentType to Instagram API media_type
      const instagramMediaType = mapToInstagramMediaType(post.contentType);
      const caption = post.caption || post.content || "";

      // Step 1: Create media container
      const containerResult = await this.client.createMediaContainer(
        caption,
        post.mediaUrl ?? undefined,
        instagramMediaType
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
