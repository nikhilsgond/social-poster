// server/src/platforms/publishers/instagram.ts
// Real Instagram publisher.
// Uses the Instagram Graph API client to publish image, video, reel,
// image Story, and video Story posts.
// The Instagram client (src/lib/instagram.ts) is completely isolated from the
// Threads client (src/lib/threads.ts) and Facebook client (src/lib/facebook.ts).
// Separate host, endpoints, parameters, tokens, and error types.
// Respects the existing scheduled_at scheduling semantics.
// Never logs the access token.
//
// Media URLs must be publicly accessible — Meta cURLs the URL from the server.
// Private URLs (Google Drive, localhost, etc.) will fail.
// Stories use media_type=STORIES and support image_url or video_url
// based on the Post content type (not URL extension).
// Stories expire after 24 hours. No interactive stickers via API.
// Video Stories are validated against the official 8MB limit before container creation.

import type { Post } from "../../types";
import type { PlatformPublisher, PublishResult } from "./interface";
import {
  InstagramGraphClient,
  validateStoryMedia,
} from "../../lib/instagram";
import { logInfo, logError } from "../../lib/logger";
import { getContentTypeCapability, validatePlatformPostCapability } from "../../platform-capabilities";

// ── Instagram media_type mapping ──
// Social Planner uses canonical content types from platform-capabilities.ts.
// Instagram API requires: IMAGE, VIDEO, REELS, or STORIES.
// This mapping validates and converts the planner type to the Instagram API type.
// Unsupported values throw a local error before calling the API.
// Stories use media_type=STORIES and support image_url or video_url.

function mapToInstagramMediaType(contentType: string | undefined): string {
  const capability = getContentTypeCapability("ig", contentType);
  if (!capability) throw new Error(`Unsupported Instagram content type: ${contentType || "(empty)"}`);
  return capability.backendType;
}

export class InstagramPublisher implements PlatformPublisher {
  private client: InstagramGraphClient;

  constructor(userId: string, accessToken: string) {
    this.client = new InstagramGraphClient({ userId, accessToken });
  }

  async publish(post: Post): Promise<PublishResult> {
    logInfo(`Instagram publish received`, { postId: post.id, platform: post.platform });

    const validation = validatePlatformPostCapability(post);
    if (validation.errors.length > 0) {
      const error = validation.errors.join(" ");
      logError("Instagram publish validation failed", { postId: post.id, error });
      return { success: false, error };
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

      // Step 0: Validate Story media before creating container
      // For video Stories, enforce the official 8MB size limit
      // For image Stories, just ensure a valid mediaUrl exists
      let isVideoStory: boolean | undefined;
      if (instagramMediaType === "STORIES") {
        const storyValidation = await validateStoryMedia(
          post.mediaUrl ?? undefined,
          validation.canonicalContentType
        );
        if (!storyValidation.isValid) {
          logError("Instagram Story validation failed", {
            error: storyValidation.error,
          });
          return { success: false, error: storyValidation.error || "Story validation failed" };
        }
        isVideoStory = storyValidation.isVideo;
        logInfo(`Instagram Story validated`, {
          isVideo: isVideoStory,
          mediaUrl: post.mediaUrl ? "(set)" : "(empty)",
        });
      }

      // Step 1: Create media container
      const containerResult = await this.client.createMediaContainer(
        caption,
        post.mediaUrl ?? undefined,
        instagramMediaType,
        undefined,
        isVideoStory
      );

      if (!containerResult.success || !containerResult.containerId) {
        logError("Instagram container creation failed", { error: containerResult.error });
        return { success: false, error: containerResult.error || "Container creation failed" };
      }

      logInfo(`Instagram container created`, { containerId: containerResult.containerId });

      // Step 2: Check container status (important for video/Reels/Carousels)
      // and then publish the container
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
